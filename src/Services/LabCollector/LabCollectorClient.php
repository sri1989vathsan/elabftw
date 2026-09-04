<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Services\LabCollector;

use Defuse\Crypto\Crypto;
use Defuse\Crypto\Exception\WrongKeyOrModifiedCiphertextException;
use Defuse\Crypto\Key;
use Elabftw\Elabftw\Env;
use Elabftw\Exceptions\ImproperActionException;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use JsonException;

use function array_filter;
use function array_is_list;
use function array_key_exists;
use function array_slice;
use function array_values;
use function is_array;
use function is_scalar;
use function json_decode;
use function ltrim;
use function rawurlencode;
use function rtrim;
use function sprintf;
use function str_starts_with;
use function strlen;
use function trim;

/**
 * Thin LabCollector adapter, scoped to the current team's own LabCollector
 * instance and API key (Admin > Others > Setup > Web services API in
 * LabCollector, header X-LC-APP-Auth, endpoints under /webservice/v2/).
 *
 * Modules in LabCollector are user-defined per installation (Samples,
 * Storage, Strains, Plasmids, ...), so records are returned as loosely
 * normalized associative arrays rather than a fixed shape.
 */
final class LabCollectorClient
{
    private const int TIMEOUT_SECONDS = 15;

    private const int MAX_RESULTS = 250;

    private const int MAX_RESPONSE_BYTES = 5_000_000;

    /** Candidate field names a LabCollector module might use for a record's display name */
    private const array NAME_FIELDS = array('name', 'title', 'plasmid_name', 'strain_name', 'sample_name', 'label', 'gene_name');

    /** Candidate field names a LabCollector module might use for where the record is physically stored */
    private const array STORAGE_FIELDS = array(
        'storage', 'storage_location', 'location', 'storage_unit',
        'box', 'box_name', 'freezer', 'shelf', 'position', 'unit_hierarchy',
    );

    private Client $client;

    private string $baseUrl;

    private string $apiKey;

    /** @param array<string, mixed> $teamArr */
    public function __construct(array $teamArr, ?Client $client = null)
    {
        $this->client = $client ?? new Client();
        $this->baseUrl = rtrim(trim((string) ($teamArr['labcollector_url'] ?? '')), '/');
        $this->apiKey = self::decryptApiKey((string) ($teamArr['labcollector_api_key'] ?? ''));
    }

    public function isConfigured(): bool
    {
        return $this->baseUrl !== '' && $this->apiKey !== '';
    }

    /** @return array{configured: bool, connected: bool, message: string} */
    public function getStatus(): array
    {
        if (!$this->isConfigured()) {
            return array(
                'configured' => false,
                'connected' => false,
                'message' => 'Configure the LabCollector URL and API key for this team first.',
            );
        }

        try {
            $this->requestJson('GET', '/webservice/v2/biocollections/list');
        } catch (ImproperActionException $e) {
            return array('configured' => true, 'connected' => false, 'message' => $e->getMessage());
        }

        return array('configured' => true, 'connected' => true, 'message' => 'Connected to the configured LabCollector instance.');
    }

    /** @return list<string> */
    public function listModules(): array
    {
        $payload = $this->requestJson('GET', '/webservice/v2/biocollections/list');
        $rows = $this->extractRows($payload);
        $modules = array();
        foreach ($rows as $row) {
            $name = $this->value($row, array('table', 'module', 'name', 'title'));
            if ($name !== '') {
                $modules[] = $name;
            }
        }
        return array_values(array_filter($modules));
    }

    /**
     * @param array<string, scalar|null> $filters
     * @return list<array<string, mixed>>
     */
    public function searchRecords(string $module, array $filters = array()): array
    {
        $module = trim($module);
        if ($module === '') {
            throw new ImproperActionException('Choose a LabCollector module first.');
        }
        $q = trim((string) ($filters['q'] ?? ''));
        $path = $q !== ''
            ? sprintf('/webservice/v2/%s/search/%s', rawurlencode($module), rawurlencode($q))
            : sprintf('/webservice/v2/%s/list', rawurlencode($module));
        $payload = $this->requestJson('GET', $path);
        return array_slice($this->extractRows($payload), 0, self::MAX_RESULTS);
    }

    /** @return array<string, mixed> */
    public function getRecord(string $module, string $id): array
    {
        $module = trim($module);
        $id = trim($id);
        if ($module === '' || $id === '') {
            throw new ImproperActionException('Missing LabCollector module or record identifier.');
        }
        $payload = $this->requestJson('GET', sprintf('/webservice/v2/%s/%s', rawurlencode($module), rawurlencode($id)));
        $rows = $this->extractRows($payload);
        if ($rows === array()) {
            throw new ImproperActionException('LabCollector record not found.');
        }
        return $rows[0];
    }

    /**
     * Fetch just enough about one record to enrich a link inserted into an
     * entity's body: its display name and, if the module tracks it, where
     * it's physically stored. Field names vary per LabCollector module
     * configuration, so this tries a generous list of common candidates
     * rather than assuming a fixed schema.
     *
     * @return array{name: string, storage: string}
     */
    public function getSummary(string $module, string $id): array
    {
        $row = $this->getRecord($module, $id);
        return array(
            'name' => $this->value($row, self::NAME_FIELDS),
            'storage' => $this->value($row, self::STORAGE_FIELDS),
        );
    }

    /** @return array<string, mixed> */
    private function requestJson(string $method, string $path): array
    {
        if (!$this->isConfigured()) {
            throw new ImproperActionException('Configure the LabCollector URL and API key for this team first.');
        }
        if (!str_starts_with($this->baseUrl, 'https://') && !str_starts_with($this->baseUrl, 'http://')) {
            throw new ImproperActionException('Configure a valid LabCollector base URL first.');
        }
        $url = $this->baseUrl . '/' . ltrim($path, '/');

        try {
            $response = $this->client->request($method, $url, array(
                'timeout' => self::TIMEOUT_SECONDS,
                'connect_timeout' => self::TIMEOUT_SECONDS,
                'http_errors' => false,
                'headers' => array(
                    'Accept' => 'application/json',
                    'X-LC-APP-Auth' => $this->apiKey,
                ),
            ));
        } catch (GuzzleException $e) {
            throw new ImproperActionException('Could not connect to the configured LabCollector instance.', previous: $e);
        }

        $status = $response->getStatusCode();
        if ($status < 200 || $status >= 300) {
            throw new ImproperActionException(sprintf('LabCollector returned HTTP %d.', $status));
        }

        $body = trim((string) $response->getBody());
        if (strlen($body) > self::MAX_RESPONSE_BYTES) {
            throw new ImproperActionException('LabCollector response is too large.');
        }
        if ($body === '') {
            return array();
        }
        try {
            $decoded = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new ImproperActionException('LabCollector returned a non-JSON response. Check the configured URL.', previous: $e);
        }
        if (!is_array($decoded)) {
            throw new ImproperActionException('LabCollector returned an unexpected JSON payload.');
        }
        return $decoded;
    }

    /** @param array<string, mixed> $payload @return list<array<string, mixed>> */
    private function extractRows(array $payload): array
    {
        if (array_is_list($payload)) {
            return array_values(array_filter($payload, 'is_array'));
        }
        foreach (array('data', 'results', 'records', 'items') as $key) {
            if (isset($payload[$key]) && is_array($payload[$key])) {
                return array_values(array_filter($payload[$key], 'is_array'));
            }
        }
        if ($payload !== array()) {
            return array($payload);
        }
        return array();
    }

    /** @param array<string, mixed> $row @param list<string> $keys */
    private function value(array $row, array $keys): string
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $row) && is_scalar($row[$key])) {
                return trim((string) $row[$key]);
            }
        }
        return '';
    }

    private static function decryptApiKey(string $encrypted): string
    {
        if ($encrypted === '') {
            return '';
        }
        try {
            return Crypto::decrypt($encrypted, Key::loadFromAsciiSafeString(Env::asString('SECRET_KEY')));
        } catch (WrongKeyOrModifiedCiphertextException) {
            return '';
        }
    }
}
