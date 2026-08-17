<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Services\Pyrat;

use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Models\Config;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use JsonException;

use function array_filter;
use function array_is_list;
use function array_key_exists;
use function array_map;
use function array_slice;
use function array_values;
use function count;
use function implode;
use function is_array;
use function is_scalar;
use function in_array;
use function json_decode;
use function ltrim;
use function mb_strtolower;
use function parse_url;
use function rawurlencode;
use function rtrim;
use function sprintf;
use function str_contains;
use function str_replace;
use function str_starts_with;
use function strlen;
use function strpos;
use function substr;
use function trim;

/**
 * Thin PyRAT adapter.
 *
 * Public PyRAT documentation confirms an integration API exists, but the exact
 * endpoint layout and payload field names are installation specific/not public.
 * For that reason this client deliberately keeps endpoint paths configurable
 * and normalizes common response shapes. It can be developed/tested safely in
 * demo mode before institutional API details are supplied.
 */
final class PyratClient
{
    private const int TIMEOUT_SECONDS = 15;

    private const int MAX_RESULTS = 250;

    private const int MAX_RESPONSE_BYTES = 5_000_000;

    private Client $client;

    /** @var array<string, mixed> */
    private array $config;

    /** @param array<string, mixed>|null $config */
    public function __construct(?Client $client = null, ?array $config = null)
    {
        $this->client = $client ?? new Client();
        $this->config = $config ?? Config::getConfig()->configArr;
    }

    public function isEnabled(): bool
    {
        return (string) ($this->config['pyrat_enabled'] ?? '0') === '1';
    }

    public function isDemoMode(): bool
    {
        return (string) ($this->config['pyrat_demo_mode'] ?? '1') === '1';
    }

    public function getScoresheetUrl(string $entityType, string $entityId): string
    {
        $template = trim((string) ($this->config['pyrat_scoresheet_url'] ?? ''));
        if ($template === '' || !in_array($entityType, array('animal', 'cage'), true)) {
            return '';
        }
        if (!str_starts_with($template, 'https://') && !str_starts_with($template, 'http://')) {
            return '';
        }

        $url = str_replace(
            array('{type}', '{id}'),
            array(rawurlencode($entityType), rawurlencode($entityId)),
            $template,
        );
        if ($url !== $template) {
            return $url;
        }
        $separator = str_contains($url, '?') ? '&' : '?';
        return sprintf('%s%sentity_type=%s&entity_id=%s', $url, $separator, rawurlencode($entityType), rawurlencode($entityId));
    }

    public function getScoresheetHomeUrl(): string
    {
        $url = trim((string) ($this->config['pyrat_scoresheet_url'] ?? ''));
        if (!str_starts_with($url, 'https://') && !str_starts_with($url, 'http://')) {
            return '';
        }
        $typePosition = strpos($url, '{type}');
        $idPosition = strpos($url, '{id}');
        if ($typePosition === false) {
            return $idPosition === false ? $url : substr($url, 0, $idPosition);
        }
        if ($idPosition === false) {
            return substr($url, 0, $typePosition);
        }
        return substr($url, 0, $typePosition < $idPosition ? $typePosition : $idPosition);
    }

    /** @return array{enabled: bool, connected: bool, demo: bool, message: string, base_url: string} */
    public function getStatus(): array
    {
        $baseUrl = trim((string) ($this->config['pyrat_base_url'] ?? ''));
        if (!$this->isEnabled()) {
            return array(
                'enabled' => false,
                'connected' => false,
                'demo' => $this->isDemoMode(),
                'message' => 'PyRAT integration is disabled.',
                'base_url' => $baseUrl,
            );
        }

        if ($this->isDemoMode()) {
            return array(
                'enabled' => true,
                'connected' => true,
                'demo' => true,
                'message' => 'Demo data is active. No request is sent to PyRAT.',
                'base_url' => $baseUrl,
            );
        }

        $animalsPath = trim((string) ($this->config['pyrat_animals_path'] ?? ''));
        if ($baseUrl === '' || $animalsPath === '') {
            return array(
                'enabled' => true,
                'connected' => false,
                'demo' => false,
                'message' => 'PyRAT base URL and Animals endpoint must be configured.',
                'base_url' => $baseUrl,
            );
        }

        try {
            $this->requestJson('GET', $animalsPath);
        } catch (ImproperActionException $e) {
            return array(
                'enabled' => true,
                'connected' => false,
                'demo' => false,
                'message' => $e->getMessage(),
                'base_url' => $baseUrl,
            );
        }

        return array(
            'enabled' => true,
            'connected' => true,
            'demo' => false,
            'message' => 'Connected to the configured PyRAT endpoint.',
            'base_url' => $baseUrl,
        );
    }

    /**
     * @param array<string, scalar|null> $filters
     * @return list<array<string, mixed>>
     */
    public function searchAnimals(array $filters = array()): array
    {
        if (!$this->isEnabled()) {
            return array();
        }
        if ($this->isDemoMode()) {
            return $this->filterDemoAnimals($filters);
        }

        $path = $this->requiredPath('pyrat_animals_path', 'Animals');
        // Do not assume institutional PyRAT query parameter names. Fetch the
        // configured collection and filter normalized fields locally until the
        // site's exact API contract is mapped in this adapter.
        $payload = $this->requestJson('GET', $path);
        $rows = $this->extractRows($payload, array('animals', 'results', 'data', 'items'));
        $animals = array_map(fn(array $row): array => $this->normalizeAnimal($row), $rows);
        return array_slice($this->filterNormalizedAnimals($animals, $filters), 0, self::MAX_RESULTS);
    }

    /** @return array<string, mixed> */
    public function getAnimal(string $animalId): array
    {
        if (!$this->isEnabled()) {
            throw new ImproperActionException('PyRAT integration is disabled.');
        }
        $animalId = trim($animalId);
        if ($animalId === '') {
            throw new ImproperActionException('Missing PyRAT animal identifier.');
        }
        if ($this->isDemoMode()) {
            foreach ($this->demoAnimals() as $animal) {
                if ((string) $animal['id'] === $animalId || (string) $animal['animal_id'] === $animalId) {
                    return $animal;
                }
            }
            throw new ImproperActionException('Demo animal not found.');
        }

        $template = trim((string) ($this->config['pyrat_animal_path'] ?? ''));
        if ($template !== '') {
            $payload = $this->requestJson('GET', $this->expandIdPath($template, $animalId));
            $row = $this->extractSingleRow($payload, array('animal', 'data', 'result'));
            return $this->normalizeAnimal($row);
        }

        foreach ($this->searchAnimals(array('q' => $animalId)) as $animal) {
            if ((string) $animal['id'] === $animalId || (string) $animal['animal_id'] === $animalId) {
                return $animal;
            }
        }
        throw new ImproperActionException('PyRAT animal not found. Configure an Animal detail endpoint if search cannot resolve exact IDs.');
    }

    /**
     * @param array<string, scalar|null> $filters
     * @return list<array<string, mixed>>
     */
    public function searchCages(array $filters = array()): array
    {
        if (!$this->isEnabled()) {
            return array();
        }
        if ($this->isDemoMode()) {
            return $this->filterDemoCages($filters);
        }

        $path = $this->requiredPath('pyrat_cages_path', 'Cages');
        $payload = $this->requestJson('GET', $path);
        $rows = $this->extractRows($payload, array('cages', 'results', 'data', 'items'));
        $cages = array_map(fn(array $row): array => $this->normalizeCage($row), $rows);
        return array_slice($this->filterNormalizedCages($cages, $filters), 0, self::MAX_RESULTS);
    }

    /** @return array<string, mixed> */
    public function getCage(string $cageId): array
    {
        if (!$this->isEnabled()) {
            throw new ImproperActionException('PyRAT integration is disabled.');
        }
        $cageId = trim($cageId);
        if ($cageId === '') {
            throw new ImproperActionException('Missing PyRAT cage identifier.');
        }
        if ($this->isDemoMode()) {
            foreach ($this->demoCages() as $cage) {
                if ((string) $cage['id'] === $cageId || (string) $cage['cage_id'] === $cageId) {
                    return $cage;
                }
            }
            throw new ImproperActionException('Demo cage not found.');
        }

        $template = trim((string) ($this->config['pyrat_cage_path'] ?? ''));
        if ($template !== '') {
            $payload = $this->requestJson('GET', $this->expandIdPath($template, $cageId));
            $row = $this->extractSingleRow($payload, array('cage', 'data', 'result'));
            return $this->normalizeCage($row);
        }

        foreach ($this->searchCages(array('q' => $cageId)) as $cage) {
            if ((string) $cage['id'] === $cageId || (string) $cage['cage_id'] === $cageId) {
                return $cage;
            }
        }
        throw new ImproperActionException('PyRAT cage not found. Configure a Cage detail endpoint if search cannot resolve exact IDs.');
    }

    /** @param array<string, mixed> $row */
    private function normalizeAnimal(array $row): array
    {
        $id = $this->value($row, array('id', 'animal_id', 'animalId', 'animalID', 'uuid', 'identifier'));
        $animalId = $this->value($row, array('animal_id', 'animalId', 'animalID', 'name', 'identifier', 'earmark', 'id'));
        $cage = $this->value($row, array('cage', 'cage_id', 'cageId', 'cageID', 'cage_name', 'cageName'));
        return array(
            'id' => $id !== '' ? $id : $animalId,
            'animal_id' => $animalId !== '' ? $animalId : $id,
            'cage' => $cage,
            'sex' => $this->value($row, array('sex', 'gender')),
            'strain' => $this->value($row, array('strain', 'line', 'mouse_line', 'mouseLine')),
            'genotype' => $this->value($row, array('genotype', 'genotyping', 'genotype_result')),
            'dob' => $this->value($row, array('dob', 'date_of_birth', 'birth_date', 'birthDate')),
            'status' => $this->value($row, array('status', 'state', 'animal_status')),
            'project' => $this->value($row, array('project', 'experiment', 'authorization', 'licence', 'license')),
            'room' => $this->value($row, array('room', 'room_name', 'roomName')),
            'rack' => $this->value($row, array('rack', 'rack_name', 'rackName')),
            'position' => $this->value($row, array('position', 'slot', 'rack_position', 'rackPosition')),
            'responsible' => $this->value($row, array('responsible', 'owner', 'user', 'responsible_user', 'responsibleUser')),
        );
    }

    /** @param array<string, mixed> $row */
    private function normalizeCage(array $row): array
    {
        $id = $this->value($row, array('id', 'cage_id', 'cageId', 'cageID', 'uuid', 'identifier'));
        $cageId = $this->value($row, array('cage_id', 'cageId', 'cageID', 'name', 'identifier', 'id'));
        $animalCount = $this->value($row, array('animal_count', 'animalCount', 'animals_count', 'occupancy', 'count'));
        if ($animalCount === '' && isset($row['animals']) && is_array($row['animals'])) {
            $animalCount = (string) count($row['animals']);
        }
        return array(
            'id' => $id !== '' ? $id : $cageId,
            'cage_id' => $cageId !== '' ? $cageId : $id,
            'room' => $this->value($row, array('room', 'room_name', 'roomName')),
            'rack' => $this->value($row, array('rack', 'rack_name', 'rackName')),
            'position' => $this->value($row, array('position', 'slot', 'rack_position', 'rackPosition')),
            'status' => $this->value($row, array('status', 'state', 'cage_status')),
            'animal_count' => $animalCount,
            'project' => $this->value($row, array('project', 'authorization', 'licence', 'license')),
        );
    }

    /** @return array<string, mixed> */
    private function requestJson(string $method, string $path, array $options = array()): array
    {
        $baseUrl = rtrim(trim((string) ($this->config['pyrat_base_url'] ?? '')), '/');
        if ($baseUrl === '' || (!str_starts_with($baseUrl, 'https://') && !str_starts_with($baseUrl, 'http://'))) {
            throw new ImproperActionException('Configure a valid PyRAT base URL first.');
        }
        $url = $this->resolveEndpoint($baseUrl, $path);

        $requestOptions = array(
            'timeout' => self::TIMEOUT_SECONDS,
            'connect_timeout' => self::TIMEOUT_SECONDS,
            'http_errors' => false,
            'verify' => (string) ($this->config['pyrat_verify_tls'] ?? '1') === '1',
            'headers' => array('Accept' => 'application/json'),
        );
        foreach ($options as $key => $value) {
            $requestOptions[$key] = $value;
        }

        $authMode = (string) ($this->config['pyrat_auth_mode'] ?? 'basic');
        $username = (string) ($this->config['pyrat_username'] ?? '');
        $secret = (string) ($this->config['pyrat_password'] ?? '');
        if ($authMode === 'bearer') {
            if ($secret === '') {
                throw new ImproperActionException('PyRAT bearer token is not configured.');
            }
            $requestOptions['headers']['Authorization'] = 'Bearer ' . $secret;
        } elseif ($authMode === 'basic') {
            if ($username === '' || $secret === '') {
                throw new ImproperActionException('PyRAT service-account username/password are not configured.');
            }
            $requestOptions['auth'] = array($username, $secret);
        } elseif ($authMode !== 'none') {
            throw new ImproperActionException('Unknown PyRAT authentication mode.');
        }

        try {
            $response = $this->client->request($method, $url, $requestOptions);
        } catch (GuzzleException $e) {
            throw new ImproperActionException('Could not connect to the configured PyRAT service.', previous: $e);
        }
        $status = $response->getStatusCode();
        if ($status < 200 || $status >= 300) {
            throw new ImproperActionException(sprintf('PyRAT returned HTTP %d.', $status));
        }

        $contentLength = (int) $response->getHeaderLine('Content-Length');
        if ($contentLength > self::MAX_RESPONSE_BYTES) {
            throw new ImproperActionException('PyRAT response is too large. Configure a narrower collection endpoint.');
        }
        $body = trim((string) $response->getBody());
        if (strlen($body) > self::MAX_RESPONSE_BYTES) {
            throw new ImproperActionException('PyRAT response is too large. Configure a narrower collection endpoint.');
        }
        if ($body === '') {
            return array();
        }
        try {
            $decoded = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new ImproperActionException('PyRAT returned a non-JSON response. Check the configured API endpoint.', previous: $e);
        }
        if (!is_array($decoded)) {
            throw new ImproperActionException('PyRAT returned an unexpected JSON payload.');
        }
        return $decoded;
    }

    private function resolveEndpoint(string $baseUrl, string $path): string
    {
        if (!str_starts_with($path, 'http://') && !str_starts_with($path, 'https://')) {
            return $baseUrl . '/' . ltrim($path, '/');
        }

        $base = parse_url($baseUrl);
        $endpoint = parse_url($path);
        if (!is_array($base) || !is_array($endpoint)
            || ($base['scheme'] ?? null) !== ($endpoint['scheme'] ?? null)
            || ($base['host'] ?? null) !== ($endpoint['host'] ?? null)
            || ($base['port'] ?? null) !== ($endpoint['port'] ?? null)) {
            throw new ImproperActionException('Absolute PyRAT endpoints must use the configured base URL origin.');
        }
        return $path;
    }

    private function requiredPath(string $key, string $label): string
    {
        $path = trim((string) ($this->config[$key] ?? ''));
        if ($path === '') {
            throw new ImproperActionException(sprintf('%s endpoint is not configured for PyRAT.', $label));
        }
        return $path;
    }

    private function expandIdPath(string $template, string $id): string
    {
        $encodedId = rawurlencode($id);
        if (str_contains($template, '{id}')) {
            return str_replace('{id}', $encodedId, $template);
        }
        return rtrim($template, '/') . '/' . $encodedId;
    }

    /** @param array<string, mixed> $payload @param list<string> $keys @return list<array<string, mixed>> */
    private function extractRows(array $payload, array $keys): array
    {
        if (array_is_list($payload)) {
            return array_values(array_filter($payload, 'is_array'));
        }
        foreach ($keys as $key) {
            if (!array_key_exists($key, $payload) || !is_array($payload[$key])) {
                continue;
            }
            if (array_is_list($payload[$key])) {
                return array_values(array_filter($payload[$key], 'is_array'));
            }
            foreach ($keys as $nestedKey) {
                if (isset($payload[$key][$nestedKey]) && is_array($payload[$key][$nestedKey]) && array_is_list($payload[$key][$nestedKey])) {
                    return array_values(array_filter($payload[$key][$nestedKey], 'is_array'));
                }
            }
        }
        if ($this->looksLikeEntity($payload)) {
            return array($payload);
        }
        return array();
    }

    /** @param array<string, mixed> $payload @param list<string> $keys @return array<string, mixed> */
    private function extractSingleRow(array $payload, array $keys): array
    {
        if ($this->looksLikeEntity($payload)) {
            return $payload;
        }
        foreach ($keys as $key) {
            if (isset($payload[$key]) && is_array($payload[$key]) && !array_is_list($payload[$key])) {
                return $payload[$key];
            }
        }
        $rows = $this->extractRows($payload, $keys);
        if ($rows !== array()) {
            return $rows[0];
        }
        throw new ImproperActionException('PyRAT returned an unexpected entity payload.');
    }

    /** @param array<string, mixed> $row */
    private function looksLikeEntity(array $row): bool
    {
        foreach (array('id', 'animal_id', 'animalId', 'cage_id', 'cageId', 'name', 'identifier') as $key) {
            if (array_key_exists($key, $row)) {
                return true;
            }
        }
        return false;
    }

    /** @param array<string, mixed> $row @param list<string> $keys */
    private function value(array $row, array $keys): string
    {
        foreach ($keys as $key) {
            if (!array_key_exists($key, $row)) {
                continue;
            }
            $value = $row[$key];
            if (is_scalar($value)) {
                return trim((string) $value);
            }
            if (is_array($value)) {
                foreach (array('id', 'name', 'label', 'title', 'identifier') as $nested) {
                    if (isset($value[$nested]) && is_scalar($value[$nested])) {
                        return trim((string) $value[$nested]);
                    }
                }
            }
        }
        return '';
    }

    /** @param list<array<string, mixed>> $animals @param array<string, scalar|null> $filters @return list<array<string, mixed>> */
    private function filterNormalizedAnimals(array $animals, array $filters): array
    {
        $q = mb_strtolower(trim((string) ($filters['q'] ?? '')));
        $cage = mb_strtolower(trim((string) ($filters['cage'] ?? '')));
        $status = mb_strtolower(trim((string) ($filters['status'] ?? '')));
        return array_values(array_filter($animals, static function (array $animal) use ($q, $cage, $status): bool {
            if ($q !== '') {
                $haystack = mb_strtolower(implode(' ', array_map('strval', array(
                    $animal['animal_id'] ?? '', $animal['id'] ?? '', $animal['cage'] ?? '', $animal['strain'] ?? '',
                    $animal['genotype'] ?? '', $animal['project'] ?? '', $animal['status'] ?? '', $animal['responsible'] ?? '',
                ))));
                if (!str_contains($haystack, $q)) {
                    return false;
                }
            }
            if ($cage !== '' && mb_strtolower((string) ($animal['cage'] ?? '')) !== $cage) {
                return false;
            }
            if ($status !== '' && mb_strtolower((string) ($animal['status'] ?? '')) !== $status) {
                return false;
            }
            return true;
        }));
    }

    /** @param list<array<string, mixed>> $cages @param array<string, scalar|null> $filters @return list<array<string, mixed>> */
    private function filterNormalizedCages(array $cages, array $filters): array
    {
        $q = mb_strtolower(trim((string) ($filters['q'] ?? '')));
        if ($q === '') {
            return $cages;
        }
        return array_values(array_filter($cages, static function (array $cage) use ($q): bool {
            $haystack = mb_strtolower(implode(' ', array_map('strval', array(
                $cage['cage_id'] ?? '', $cage['id'] ?? '', $cage['room'] ?? '', $cage['rack'] ?? '',
                $cage['position'] ?? '', $cage['project'] ?? '', $cage['status'] ?? '',
            ))));
            return str_contains($haystack, $q);
        }));
    }

    /** @param array<string, scalar|null> $filters @return list<array<string, mixed>> */
    private function filterDemoAnimals(array $filters): array
    {
        $q = mb_strtolower(trim((string) ($filters['q'] ?? '')));
        $cage = mb_strtolower(trim((string) ($filters['cage'] ?? '')));
        $status = mb_strtolower(trim((string) ($filters['status'] ?? '')));
        return array_values(array_filter($this->demoAnimals(), static function (array $animal) use ($q, $cage, $status): bool {
            if ($q !== '') {
                $haystack = mb_strtolower(implode(' ', array_map('strval', array(
                    $animal['animal_id'], $animal['cage'], $animal['strain'], $animal['genotype'], $animal['project'], $animal['status'],
                ))));
                if (!str_contains($haystack, $q)) {
                    return false;
                }
            }
            if ($cage !== '' && mb_strtolower((string) $animal['cage']) !== $cage) {
                return false;
            }
            if ($status !== '' && mb_strtolower((string) $animal['status']) !== $status) {
                return false;
            }
            return true;
        }));
    }

    /** @param array<string, scalar|null> $filters @return list<array<string, mixed>> */
    private function filterDemoCages(array $filters): array
    {
        $q = mb_strtolower(trim((string) ($filters['q'] ?? '')));
        return array_values(array_filter($this->demoCages(), static function (array $cage) use ($q): bool {
            if ($q === '') {
                return true;
            }
            $haystack = mb_strtolower(implode(' ', array_map('strval', array(
                $cage['cage_id'], $cage['room'], $cage['rack'], $cage['position'], $cage['project'], $cage['status'],
            ))));
            return str_contains($haystack, $q);
        }));
    }

    /** @return list<array<string, mixed>> */
    private function demoAnimals(): array
    {
        $rows = array(
            array('id' => '1001234', 'animal_id' => 'M1234', 'cage' => 'C12', 'sex' => 'Male', 'strain' => 'C57BL/6J', 'genotype' => 'WT', 'dob' => '2026-05-03', 'status' => 'Active', 'project' => 'DSS-2026', 'room' => 'Mouse Room 2', 'rack' => 'R4', 'position' => 'B07', 'responsible' => 'Moor Group'),
            array('id' => '1001235', 'animal_id' => 'M1235', 'cage' => 'C12', 'sex' => 'Female', 'strain' => 'C57BL/6J', 'genotype' => 'WT', 'dob' => '2026-05-03', 'status' => 'Active', 'project' => 'DSS-2026', 'room' => 'Mouse Room 2', 'rack' => 'R4', 'position' => 'B07', 'responsible' => 'Moor Group'),
            array('id' => '1001236', 'animal_id' => 'M1236', 'cage' => 'C13', 'sex' => 'Male', 'strain' => 'C57BL/6J', 'genotype' => 'KO', 'dob' => '2026-05-10', 'status' => 'Active', 'project' => 'DSS-2026', 'room' => 'Mouse Room 2', 'rack' => 'R4', 'position' => 'B08', 'responsible' => 'Moor Group'),
            array('id' => '1001240', 'animal_id' => 'M1240', 'cage' => 'C14', 'sex' => 'Male', 'strain' => 'Villin-Cre', 'genotype' => 'Het', 'dob' => '2026-05-11', 'status' => 'Active', 'project' => 'DSS-2026', 'room' => 'Mouse Room 2', 'rack' => 'R5', 'position' => 'A02', 'responsible' => 'Moor Group'),
            array('id' => '1001241', 'animal_id' => 'M1241', 'cage' => 'C14', 'sex' => 'Female', 'strain' => 'Villin-Cre', 'genotype' => 'WT', 'dob' => '2026-05-11', 'status' => 'Active', 'project' => 'DSS-2026', 'room' => 'Mouse Room 2', 'rack' => 'R5', 'position' => 'A02', 'responsible' => 'Moor Group'),
            array('id' => '1001247', 'animal_id' => 'M1247', 'cage' => 'C18', 'sex' => 'Female', 'strain' => 'C57BL/6J', 'genotype' => 'WT', 'dob' => '2026-04-28', 'status' => 'Monitoring', 'project' => 'Recovery-2026', 'room' => 'Mouse Room 1', 'rack' => 'R2', 'position' => 'C04', 'responsible' => 'Moor Group'),
        );
        return $rows;
    }

    /** @return list<array<string, mixed>> */
    private function demoCages(): array
    {
        $rows = array(
            array('id' => 'C12', 'cage_id' => 'C12', 'room' => 'Mouse Room 2', 'rack' => 'R4', 'position' => 'B07', 'status' => 'Active', 'animal_count' => '2', 'project' => 'DSS-2026'),
            array('id' => 'C13', 'cage_id' => 'C13', 'room' => 'Mouse Room 2', 'rack' => 'R4', 'position' => 'B08', 'status' => 'Active', 'animal_count' => '1', 'project' => 'DSS-2026'),
            array('id' => 'C14', 'cage_id' => 'C14', 'room' => 'Mouse Room 2', 'rack' => 'R5', 'position' => 'A02', 'status' => 'Active', 'animal_count' => '2', 'project' => 'DSS-2026'),
            array('id' => 'C18', 'cage_id' => 'C18', 'room' => 'Mouse Room 1', 'rack' => 'R2', 'position' => 'C04', 'status' => 'Monitoring', 'animal_count' => '1', 'project' => 'Recovery-2026'),
        );
        return $rows;
    }
}
