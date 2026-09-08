<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use Elabftw\Enums\Action;
use Elabftw\Exceptions\UnauthorizedException;
use Elabftw\Interfaces\QueryParamsInterface;
use Elabftw\Models\Users\Users;
use Override;
use PDO;

use function bin2hex;
use function hash;
use function preg_match;
use function random_bytes;
use function rawurlencode;
use function sprintf;

/**
 * Manage a single private calendar subscription token for an account.
 *
 * Only a SHA-256 digest is persisted. The clear token is returned once in the
 * Location header, following the same pattern used when creating API keys.
 */
final class CalendarFeed extends AbstractRest
{
    public string $token = '';

    private int $userid;

    public function __construct(?Users $Users = null)
    {
        parent::__construct();
        $this->userid = (int) ($Users?->userData['userid'] ?? 0);
    }

    #[Override]
    public function getApiPath(): string
    {
        return sprintf(
            'calendar-feed.php?token=%s&feed=',
            rawurlencode($this->token),
        );
    }

    #[Override]
    public function readAll(?QueryParamsInterface $queryParams = null): array
    {
        $sql = 'SELECT created_at, updated_at
            FROM calendar_feed_tokens
            WHERE users_id = :users_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':users_id', $this->userid, PDO::PARAM_INT);
        $this->Db->execute($req);
        $row = $req->fetch();
        return array(
            'enabled' => $row !== false,
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        );
    }

    #[Override]
    public function postAction(Action $action, array $reqBody): int
    {
        $this->token = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $this->token);
        $sql = 'INSERT INTO calendar_feed_tokens (users_id, token_hash)
            VALUES (:users_id, :token_hash)
            ON DUPLICATE KEY UPDATE
                token_hash = VALUES(token_hash),
                updated_at = CURRENT_TIMESTAMP,
                id = LAST_INSERT_ID(id)';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':users_id', $this->userid, PDO::PARAM_INT);
        $req->bindParam(':token_hash', $tokenHash);
        $this->Db->execute($req);
        return $this->Db->lastInsertId();
    }

    #[Override]
    public function destroy(): bool
    {
        $sql = 'DELETE FROM calendar_feed_tokens WHERE users_id = :users_id';
        $req = $this->Db->prepare($sql);
        $req->bindParam(':users_id', $this->userid, PDO::PARAM_INT);
        return $this->Db->execute($req);
    }

    /**
     * Resolve a public feed token to its account without creating a session.
     */
    public static function getUseridFromToken(string $token): int
    {
        if (preg_match('/^[a-f0-9]{64}$/D', $token) !== 1) {
            throw new UnauthorizedException();
        }
        $tokenHash = hash('sha256', $token);
        $Db = Db::getConnection();
        $req = $Db->prepare(
            'SELECT users_id FROM calendar_feed_tokens WHERE token_hash = :token_hash',
        );
        $req->bindParam(':token_hash', $tokenHash);
        $Db->execute($req);
        $userid = $req->fetchColumn();
        if ($userid === false) {
            throw new UnauthorizedException();
        }
        return (int) $userid;
    }
}
