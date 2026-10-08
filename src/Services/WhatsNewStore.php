<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Services;

use Elabftw\Exceptions\ImproperActionException;
use JsonException;
use Symfony\Component\HttpFoundation\File\UploadedFile;

use function array_filter;
use function array_map;
use function array_values;
use function bin2hex;
use function dirname;
use function file_get_contents;
use function file_put_contents;
use function getimagesize;
use function in_array;
use function is_array;
use function is_dir;
use function is_file;
use function json_decode;
use function json_encode;
use function mkdir;
use function preg_match;
use function random_bytes;
use function rename;
use function uasort;
use function unlink;

use const JSON_PRETTY_PRINT;
use const JSON_THROW_ON_ERROR;
use const JSON_UNESCAPED_SLASHES;
use const JSON_UNESCAPED_UNICODE;
use const LOCK_EX;

/**
 * The entries of the "What's new" page.
 *
 * The entries shipped with the code (src/whats-new.json, pictures in
 * web/assets/images/whats-new) are the starting point. What an admin changes is
 * kept apart, in the persistent uploads volume: an edited entry replaces the
 * shipped one with the same id, a deleted shipped entry stays hidden, and
 * new entries are added. Entries shipped later still show up on their own.
 */
final class WhatsNewStore
{
    public const int MAX_IMAGE_BYTES = 8_000_000;

    private const string SHIPPED_ENTRIES = __DIR__ . '/../whats-new.json';

    private const string SHIPPED_IMAGES = __DIR__ . '/../../web/assets/images/whats-new';

    private const string DATA_DIR = '/var/lib/elabftw/uploads/whats-new';

    private const array IMAGE_TYPES = array(
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
    );

    /**
     * @return array<int, array<string, mixed>> newest first
     */
    public function all(): array
    {
        $state = $this->readState();
        $byId = array();
        foreach ($this->readList(self::SHIPPED_ENTRIES) as $entry) {
            if (!in_array($entry['id'], $state['deleted'], true)) {
                $byId[$entry['id']] = $entry;
            }
        }
        foreach ($state['entries'] as $id => $entry) {
            $byId[$id] = $entry;
        }
        uasort($byId, static fn(array $a, array $b): int => ($b['date'] ?? '') <=> ($a['date'] ?? ''));

        return array_values($byId);
    }

    /**
     * @param array<string, mixed> $entry already validated by the caller
     */
    public function save(array $entry, ?UploadedFile $image, bool $removeImage): string
    {
        $state = $this->readState();
        $id = (string) $entry['id'];
        $previous = $this->find($id);
        $oldImage = (string) ($previous['image'] ?? '');

        if ($image instanceof UploadedFile) {
            $entry['image'] = $this->storeImage($image, $id);
        } elseif ($removeImage) {
            $entry['image'] = '';
            unset($entry['highlight']);
        } else {
            $entry['image'] = $oldImage;
        }
        $state['entries'][$id] = $entry;
        $state['deleted'] = array_values(array_filter($state['deleted'], static fn(string $d): bool => $d !== $id));
        $this->writeState($state);
        if ($oldImage !== '' && $oldImage !== $entry['image']) {
            $this->removeStoredImage($oldImage);
        }

        return $id;
    }

    public function delete(string $id): void
    {
        $state = $this->readState();
        $previous = $this->find($id);
        unset($state['entries'][$id]);
        $shippedIds = array_map(static fn(array $e): string => $e['id'], $this->readList(self::SHIPPED_ENTRIES));
        if (in_array($id, $shippedIds, true) && !in_array($id, $state['deleted'], true)) {
            $state['deleted'][] = $id;
        }
        $this->writeState($state);
        $image = (string) ($previous['image'] ?? '');
        if ($image !== '') {
            $this->removeStoredImage($image);
        }
    }

    /**
     * Absolute path of a picture, or null. Edited pictures live in the data
     * directory, the ones shipped with the code next to the assets.
     */
    public function imagePath(string $name): ?string
    {
        if (!$this->isSafeFileName($name)) {
            return null;
        }
        foreach (array(self::DATA_DIR . '/images', self::SHIPPED_IMAGES) as $dir) {
            if (is_file($dir . '/' . $name)) {
                return $dir . '/' . $name;
            }
        }

        return null;
    }

    public function isSafeFileName(string $name): bool
    {
        return preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpg|jpeg|png|webp|gif)$/', $name) === 1;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(string $id): ?array
    {
        foreach ($this->all() as $entry) {
            if ($entry['id'] === $id) {
                return $entry;
            }
        }

        return null;
    }

    private function storeImage(UploadedFile $file, string $id): string
    {
        if (!$file->isValid()) {
            throw new ImproperActionException('The picture could not be uploaded. Try a smaller file.');
        }
        if ($file->getSize() > self::MAX_IMAGE_BYTES) {
            throw new ImproperActionException('The picture is too large (8 MB at most).');
        }
        $info = @getimagesize($file->getPathname());
        $mime = is_array($info) ? (string) $info['mime'] : '';
        if (!isset(self::IMAGE_TYPES[$mime])) {
            throw new ImproperActionException('Use a JPG, PNG, WebP or GIF picture.');
        }
        $dir = self::DATA_DIR . '/images';
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new ImproperActionException('Could not create the folder for pictures.');
        }
        $name = $id . '-' . bin2hex(random_bytes(4)) . '.' . self::IMAGE_TYPES[$mime];
        $file->move($dir, $name);

        return $name;
    }

    private function removeStoredImage(string $name): void
    {
        // Only pictures kept in the data directory are ever removed; the ones
        // shipped with the code are part of the image.
        $path = self::DATA_DIR . '/images/' . $name;
        if ($this->isSafeFileName($name) && is_file($path)) {
            @unlink($path);
        }
    }

    /**
     * @return array{entries: array<string, array<string, mixed>>, deleted: array<int, string>}
     */
    private function readState(): array
    {
        $file = self::DATA_DIR . '/entries.json';
        $state = array('entries' => array(), 'deleted' => array());
        if (!is_file($file)) {
            return $state;
        }
        try {
            $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return $state;
        }
        if (is_array($decoded['entries'] ?? null)) {
            foreach ($decoded['entries'] as $id => $entry) {
                if (is_array($entry) && isset($entry['id']) && (string) $id === $entry['id']) {
                    $state['entries'][(string) $id] = $entry;
                }
            }
        }
        if (is_array($decoded['deleted'] ?? null)) {
            $state['deleted'] = array_values(array_filter($decoded['deleted'], 'is_string'));
        }

        return $state;
    }

    /**
     * @param array{entries: array<string, array<string, mixed>>, deleted: array<int, string>} $state
     */
    private function writeState(array $state): void
    {
        $file = self::DATA_DIR . '/entries.json';
        $dir = dirname($file);
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new ImproperActionException('Could not create the folder for the What\'s new entries.');
        }
        $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        // Write to a temporary file first so a failure never leaves a half-written list.
        $tmp = $file . '.tmp';
        if (file_put_contents($tmp, $json . "\n", LOCK_EX) === false || !rename($tmp, $file)) {
            throw new ImproperActionException('Could not save the What\'s new entries.');
        }
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function readList(string $file): array
    {
        if (!is_file($file)) {
            return array();
        }
        try {
            $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return array();
        }

        return is_array($decoded)
            ? array_values(array_filter($decoded, static fn($e): bool => is_array($e) && isset($e['id'])))
            : array();
    }
}
