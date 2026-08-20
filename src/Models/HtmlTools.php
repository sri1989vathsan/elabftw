<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\FeatureFlags;
use Elabftw\Enums\Action;
use Elabftw\Enums\Storage;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Exceptions\ResourceNotFoundException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Elabftw\Traits\SetIdTrait;
use JsonException;
use League\Flysystem\Filesystem;
use Override;
use PDO;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Throwable;
use ZipArchive;

use function array_key_exists;
use function array_sum;
use function basename;
use function count;
use function dirname;
use function fclose;
use function fopen;
use function in_array;
use function is_array;
use function is_string;
use function json_decode;
use function ltrim;
use function mb_substr;
use function pathinfo;
use function preg_match;
use function sprintf;
use function str_ends_with;
use function str_replace;
use function strtolower;
use function trim;

/**
 * Instance-wide HTML tools installed by a sysadmin.
 *
 * Packages live below /elabftw/uploads/html-tools, which is part of the
 * normal persistent uploads mount. They are only ever served through the
 * sandboxed HTML tool controller, never as regular uploaded attachments.
 */
final class HtmlTools extends AbstractRest
{
    use SetIdTrait;

    public const string STORAGE_ROOT = 'html-tools';

    private const int MAX_ARCHIVE_BYTES = 25_000_000;

    private const int MAX_EXPANDED_BYTES = 75_000_000;

    private const int MAX_FILES = 500;

    private const int MAX_MANIFEST_BYTES = 65_536;

    /** Files with these extensions must never become part of an installed package. */
    private const array BLOCKED_EXTENSIONS = array(
        'cgi', 'htaccess', 'phar', 'php', 'php3', 'php4', 'php5', 'phtml', 'pl', 'py', 'sh',
    );

    private Filesystem $filesystem;

    public function __construct(private Users $requester, ?int $id = null)
    {
        if (!FeatureFlags::HTML_TOOLS) {
            throw new ResourceNotFoundException();
        }
        parent::__construct();
        $this->setId($id);
        $this->filesystem = Storage::LOCAL->getStorage()->getFs();
    }

    #[Override]
    public function getApiPath(): string
    {
        return 'api/v2/html_tools/';
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $where = $this->requester->isSysadmin() ? '' : 'WHERE h.enabled = 1';
        $sql = sprintf(
            'SELECT h.id, h.name, h.description, h.version, h.entrypoint, h.enabled,
                h.uploaded_by, h.created_at, h.updated_at,
                TRIM(CONCAT(u.firstname, " ", u.lastname)) AS uploaded_by_name
            FROM html_tools AS h
            LEFT JOIN users AS u ON (u.userid = h.uploaded_by)
            %s
            ORDER BY h.name ASC',
            $where,
        );
        $req = $this->Db->prepare($sql);
        $this->Db->execute($req);
        return $this->addLaunchUrls($req->fetchAll());
    }

    #[Override]
    public function readOne(): array
    {
        if ($this->id === null) {
            throw new ResourceNotFoundException();
        }
        $enabledRestriction = $this->requester->isSysadmin() ? '' : ' AND h.enabled = 1';
        $sql = sprintf(
            'SELECT h.id, h.name, h.description, h.version, h.entrypoint, h.enabled,
                h.uploaded_by, h.created_at, h.updated_at,
                TRIM(CONCAT(u.firstname, " ", u.lastname)) AS uploaded_by_name
            FROM html_tools AS h
            LEFT JOIN users AS u ON (u.userid = h.uploaded_by)
            WHERE h.id = :id%s',
            $enabledRestriction,
        );
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        $this->Db->execute($req);
        $tool = $req->fetch();
        if ($tool === false) {
            throw new ResourceNotFoundException();
        }
        return $this->addLaunchUrls(array($tool))[0];
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $this->requester->isSysadminOrExplode();
        $file = $reqBody['file'] ?? null;
        if (!$file instanceof UploadedFile || !$file->isValid()) {
            throw new ImproperActionException('Choose a valid HTML or ZIP tool package.');
        }
        if (($file->getSize() ?? 0) > self::MAX_ARCHIVE_BYTES) {
            throw new ImproperActionException('The HTML tool package is larger than 25 MB.');
        }

        $package = $this->inspectPackage($file);
        $name = $this->cleanText((string) ($reqBody['name'] ?? ''), 255)
            ?: $this->cleanText((string) ($package['manifest']['name'] ?? ''), 255)
            ?: $this->cleanText(pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME), 255);
        if ($name === '') {
            throw new ImproperActionException('Give the HTML tool a name.');
        }
        $description = $this->cleanText((string) ($reqBody['description'] ?? ''), 2_000)
            ?: $this->cleanText((string) ($package['manifest']['description'] ?? ''), 2_000);
        $version = $this->cleanText((string) ($package['manifest']['version'] ?? ''), 64);

        if ($this->id !== null) {
            $this->readOne();
            $toolId = $this->id;
            $this->filesystem->deleteDirectory($this->getToolDirectory($toolId));
            $sql = 'UPDATE html_tools
                SET name = :name, description = :description, version = :version,
                    entrypoint = :entrypoint, uploaded_by = :uploadedBy
                WHERE id = :id';
            $req = $this->Db->prepare($sql);
            $req->bindParam(':id', $toolId, PDO::PARAM_INT);
        } else {
            $sql = 'INSERT INTO html_tools
                (name, description, version, entrypoint, enabled, uploaded_by)
                VALUES (:name, :description, :version, :entrypoint, 1, :uploadedBy)';
            $req = $this->Db->prepare($sql);
        }
        $req->bindValue(':name', $name);
        $req->bindValue(':description', $description);
        $req->bindValue(':version', $version);
        $req->bindValue(':entrypoint', $package['entrypoint']);
        $req->bindValue(':uploadedBy', $this->requester->getUserid(), PDO::PARAM_INT);
        $this->Db->execute($req);
        $toolId = $this->id ?? $this->Db->lastInsertId();

        try {
            $this->installPackage($file, $package, $toolId);
        } catch (Throwable $e) {
            $this->filesystem->deleteDirectory($this->getToolDirectory($toolId));
            if ($this->id === null) {
                $delete = $this->Db->prepare('DELETE FROM html_tools WHERE id = :id');
                $delete->bindValue(':id', $toolId, PDO::PARAM_INT);
                $this->Db->execute($delete);
            }
            throw new ImproperActionException('Could not install the HTML tool package.', previous: $e);
        }
        return $toolId;
    }

    #[Override]
    public function patch(Action $action, array $params): array
    {
        $this->requester->isSysadminOrExplode();
        $this->readOne();
        $updates = array();
        $bindings = array();
        if (array_key_exists('name', $params)) {
            $name = $this->cleanText((string) $params['name'], 255);
            if ($name === '') {
                throw new ImproperActionException('The HTML tool name cannot be empty.');
            }
            $updates[] = 'name = :name';
            $bindings['name'] = $name;
        }
        if (array_key_exists('description', $params)) {
            $updates[] = 'description = :description';
            $bindings['description'] = $this->cleanText((string) $params['description'], 2_000);
        }
        if (array_key_exists('enabled', $params)) {
            $updates[] = 'enabled = :enabled';
            $bindings['enabled'] = (int) ((bool) $params['enabled']);
        }
        if ($updates === array()) {
            return $this->readOne();
        }
        $sql = sprintf('UPDATE html_tools SET %s WHERE id = :id', implode(', ', $updates));
        $req = $this->Db->prepare($sql);
        $req->bindValue(':id', $this->id, PDO::PARAM_INT);
        foreach ($bindings as $key => $value) {
            $req->bindValue(':' . $key, $value, $key === 'enabled' ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $this->Db->execute($req);
        return $this->readOne();
    }

    #[Override]
    public function destroy(): bool
    {
        $this->requester->isSysadminOrExplode();
        $this->readOne();
        $this->filesystem->deleteDirectory($this->getToolDirectory((int) $this->id));
        $sql = 'DELETE FROM html_tools WHERE id = :id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':id', $this->id, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    public function getAssetStoragePath(string $assetPath): string
    {
        if ($this->id === null) {
            throw new ResourceNotFoundException();
        }
        return $this->getToolDirectory($this->id) . '/' . self::normalizePackagePath($assetPath);
    }

    public function getFilesystem(): Filesystem
    {
        return $this->filesystem;
    }

    public static function normalizePackagePath(string $path): string
    {
        $path = str_replace('\\', '/', trim($path));
        if ($path === '' || str_starts_with($path, '/') || preg_match('/[\x00-\x1F\x7F]/u', $path) === 1) {
            throw new ImproperActionException('Invalid HTML tool file path.');
        }
        $parts = explode('/', $path);
        foreach ($parts as $part) {
            if ($part === '' || $part === '.' || $part === '..') {
                throw new ImproperActionException('Invalid HTML tool file path.');
            }
        }
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (in_array($extension, self::BLOCKED_EXTENSIONS, true)) {
            throw new ImproperActionException('Executable server files are not allowed in HTML tools.');
        }
        return $path;
    }

    private function addLaunchUrls(array $tools): array
    {
        foreach ($tools as &$tool) {
            $tool['enabled'] = (int) $tool['enabled'];
            $tool['launch_url'] = sprintf(
                '/html-tools/%d/%s',
                (int) $tool['id'],
                implode('/', array_map('rawurlencode', explode('/', $tool['entrypoint']))),
            );
        }
        return $tools;
    }

    private function getToolDirectory(int $id): string
    {
        return sprintf('%s/%d', self::STORAGE_ROOT, $id);
    }

    /** @return array{kind: string, entrypoint: string, files: array<int, array{name: string, index: int, size: int}>, manifest: array} */
    private function inspectPackage(UploadedFile $file): array
    {
        $extension = strtolower($file->getClientOriginalExtension());
        if (in_array($extension, array('html', 'htm'), true)) {
            return array(
                'kind' => 'html',
                'entrypoint' => 'index.html',
                'files' => array(),
                'manifest' => array(),
            );
        }
        if ($extension !== 'zip') {
            throw new ImproperActionException('HTML tools must be an .html file or a .zip package.');
        }

        $zip = new ZipArchive();
        if ($zip->open($file->getPathname()) !== true) {
            throw new ImproperActionException('Could not open the ZIP tool package.');
        }
        try {
            $files = array();
            $htmlFiles = array();
            $manifestCandidates = array();
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $stat = $zip->statIndex($index);
                if (!is_array($stat) || !is_string($stat['name'] ?? null)) {
                    throw new ImproperActionException('Could not inspect a file in the ZIP package.');
                }
                $rawName = $stat['name'];
                if (str_ends_with($rawName, '/')) {
                    continue;
                }
                $name = self::normalizePackagePath($rawName);
                $size = (int) ($stat['size'] ?? 0);
                $files[] = array('name' => $name, 'index' => $index, 'size' => $size);
                $baseName = strtolower(basename($name));
                if ($baseName === 'index.html' || $baseName === 'index.htm') {
                    $htmlFiles[] = $name;
                }
                if ($baseName === 'tool.json') {
                    $manifestCandidates[] = array('name' => $name, 'index' => $index, 'size' => $size);
                }
            }
            if ($files === array() || count($files) > self::MAX_FILES) {
                throw new ImproperActionException('The ZIP tool package must contain between 1 and 500 files.');
            }
            if (array_sum(array_column($files, 'size')) > self::MAX_EXPANDED_BYTES) {
                throw new ImproperActionException('The expanded HTML tool package is larger than 75 MB.');
            }
            if ($htmlFiles === array()) {
                throw new ImproperActionException('The ZIP tool package needs an index.html file.');
            }

            usort($manifestCandidates, static fn(array $a, array $b): int => substr_count($a['name'], '/') <=> substr_count($b['name'], '/'));
            $manifest = array();
            $manifestDirectory = '.';
            if ($manifestCandidates !== array()) {
                $candidate = $manifestCandidates[0];
                if ($candidate['size'] > self::MAX_MANIFEST_BYTES) {
                    throw new ImproperActionException('tool.json is larger than 64 KB.');
                }
                $manifestJson = $zip->getFromIndex($candidate['index']);
                try {
                    $decoded = json_decode((string) $manifestJson, true, 32, JSON_THROW_ON_ERROR);
                } catch (JsonException $e) {
                    throw new ImproperActionException('tool.json is not valid JSON.', previous: $e);
                }
                if (!is_array($decoded)) {
                    throw new ImproperActionException('tool.json must contain a JSON object.');
                }
                $manifest = $decoded;
                $manifestDirectory = dirname($candidate['name']);
            }

            $entrypoint = '';
            if (is_string($manifest['entrypoint'] ?? null) && trim($manifest['entrypoint']) !== '') {
                $entrypoint = self::normalizePackagePath(
                    ($manifestDirectory === '.' ? '' : $manifestDirectory . '/') . ltrim($manifest['entrypoint'], '/'),
                );
                if (!in_array($entrypoint, array_column($files, 'name'), true)) {
                    throw new ImproperActionException('The tool.json entrypoint does not exist in the ZIP package.');
                }
            } else {
                usort($htmlFiles, static fn(string $a, string $b): int => substr_count($a, '/') <=> substr_count($b, '/'));
                $entrypoint = $htmlFiles[0];
            }
            if (!in_array(strtolower(pathinfo($entrypoint, PATHINFO_EXTENSION)), array('html', 'htm'), true)) {
                throw new ImproperActionException('The HTML tool entrypoint must be an HTML file.');
            }
            return array('kind' => 'zip', 'entrypoint' => $entrypoint, 'files' => $files, 'manifest' => $manifest);
        } finally {
            $zip->close();
        }
    }

    private function installPackage(UploadedFile $file, array $package, int $toolId): void
    {
        $directory = $this->getToolDirectory($toolId);
        if ($package['kind'] === 'html') {
            $stream = fopen($file->getPathname(), 'rb');
            if ($stream === false) {
                throw new ImproperActionException('Could not read the HTML tool file.');
            }
            try {
                $this->filesystem->writeStream($directory . '/index.html', $stream);
            } finally {
                fclose($stream);
            }
            return;
        }

        $zip = new ZipArchive();
        if ($zip->open($file->getPathname()) !== true) {
            throw new ImproperActionException('Could not reopen the ZIP tool package.');
        }
        try {
            foreach ($package['files'] as $archiveFile) {
                $archiveName = $zip->getNameIndex($archiveFile['index']);
                if ($archiveName === false) {
                    throw new ImproperActionException('Could not locate a file in the ZIP tool package.');
                }
                $stream = $zip->getStream($archiveName);
                if ($stream === false) {
                    throw new ImproperActionException('Could not read a file from the ZIP tool package.');
                }
                try {
                    $this->filesystem->writeStream($directory . '/' . $archiveFile['name'], $stream);
                } finally {
                    fclose($stream);
                }
            }
        } finally {
            $zip->close();
        }
    }

    private function cleanText(string $value, int $maxLength): string
    {
        return trim(mb_substr($value, 0, $maxLength));
    }
}
