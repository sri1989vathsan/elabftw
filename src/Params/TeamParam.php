<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2022 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Params;

use Defuse\Crypto\Crypto;
use Defuse\Crypto\Key;
use Elabftw\Elabftw\Env;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Models\Orders;
use Elabftw\Services\Filter;
use JsonException;
use Override;

use function array_column;
use function array_map;
use function array_unique;
use function count;
use function in_array;
use function is_array;
use function json_decode;
use function json_encode;

use const JSON_THROW_ON_ERROR;

final class TeamParam extends ContentParams
{
    #[Override]
    public function getContent(): mixed
    {
        return match ($this->target) {
            'name', 'orgid' => parent::getContent(),
            'announcement', 'newcomer_banner',
            'onboarding_email_subject',
            'onboarding_email_body' => $this->getNullableContent(),
            'openiris_url', 'labcollector_url' => $this->getNullableUrl(),
            'labcollector_api_key' => $this->getNullableSecret(),
            'user_create_tag',
            'force_exp_tpl',
            'force_res_tpl',
            'users_canwrite_experiments',
            'users_canwrite_experiments_categories',
            'users_canwrite_experiments_status',
            'users_canwrite_experiments_templates',
            'users_canwrite_resources',
            'users_canwrite_resources_categories',
            'users_canwrite_resources_status',
            'users_canwrite_resources_templates',
            'visible',
            'newcomer_banner_active',
            'onboarding_email_active',
            'orders_autoadvance_on_procurement_id',
            'orders_autoadvance_on_attachment' => $this->getBinary(),
            'newcomer_threshold' => $this->asInt(),
            'orders_autoarchive_rules' => $this->getAutoArchiveRules(),
            default => throw new ImproperActionException('Incorrect parameter for team.' . $this->target),
        };
    }

    /**
     * $this->content is a JSON-encoded array of {"status": "...", "days": N}
     * rules (see Orders::autoArchivePastDue()) -- one rule per status, days
     * a positive integer. Re-encoded rather than passed through as-is so a
     * malformed or partial object (e.g. missing "days") can't reach storage.
     */
    private function getAutoArchiveRules(): string
    {
        try {
            $decoded = json_decode((string) $this->content, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ImproperActionException('Invalid auto-archive rules.');
        }
        if (!is_array($decoded)) {
            throw new ImproperActionException('Invalid auto-archive rules.');
        }
        $rules = array_map(function (mixed $rule): array {
            if (!is_array($rule)) {
                throw new ImproperActionException('Invalid auto-archive rule.');
            }
            $status = (string) ($rule['status'] ?? '');
            if (!in_array($status, Orders::AUTOARCHIVABLE_STATUSES, true)) {
                throw new ImproperActionException('Invalid order status for auto-archiving.');
            }
            $days = (int) ($rule['days'] ?? 0);
            if ($days <= 0) {
                throw new ImproperActionException('Number of days for auto-archiving must be a positive integer.');
            }
            return array('status' => $status, 'days' => $days);
        }, $decoded);
        if (count(array_unique(array_column($rules, 'status'))) !== count($rules)) {
            throw new ImproperActionException('Only one auto-archive rule per status is allowed.');
        }
        return json_encode($rules, JSON_THROW_ON_ERROR);
    }

    private function getNullableContent(): ?string
    {
        if (empty($this->content)) {
            return null;
        }
        return Filter::body(parent::getContent());
    }

    private function getNullableUrl(): ?string
    {
        if (empty($this->content)) {
            return null;
        }
        $url = Filter::toPureString(parent::getContent());
        if (!filter_var($url, FILTER_VALIDATE_URL)) {
            throw new ImproperActionException('Please enter a valid URL.');
        }
        return $url;
    }

    // Encrypt at rest with the same SECRET_KEY convention as Config::ENCRYPTED_KEYS,
    // since unlike other team params this column can be read back through the team API.
    private function getNullableSecret(): ?string
    {
        if (empty($this->content)) {
            return null;
        }
        $secret = Filter::toPureString(parent::getContent());
        return Crypto::encrypt($secret, Key::loadFromAsciiSafeString(Env::asString('SECRET_KEY')));
    }
}
