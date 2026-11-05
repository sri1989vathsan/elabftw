<?php

/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Models\Users\Users;
use PDO;

use function _;
use function filter_var;
use function mb_substr;
use function parse_url;
use function in_array;
use function str_contains;
use function strtolower;
use function trim;

/** The shared table of links behind Links > Others: everyone in the team can add one, only its author or an admin removes it. */
final class OtherLinks
{
    private Db $Db;

    public function __construct(private Users $requester)
    {
        $this->Db = Db::getConnection();
    }

    /** @return list<array<string, mixed>> */
    public function readAll(): array
    {
        $sql = 'SELECT l.id, l.userid, l.title, l.url, l.description, l.created_at,
                TRIM(CONCAT(u.firstname, " ", u.lastname)) AS author
            FROM custom_other_links AS l
            LEFT JOIN users AS u ON u.userid = l.userid
            WHERE l.team = :team
            ORDER BY l.title';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->requester->team, PDO::PARAM_INT);
        $this->Db->execute($req);
        return $req->fetchAll();
    }

    public function create(string $title, string $url, string $description): int
    {
        $title = mb_substr(trim($title), 0, 255);
        $url = trim($url);
        if ($title === '') {
            throw new ImproperActionException(_('Please give the link a title.'));
        }
        // a bare address like wiki.ethz.ch is taken as https
        if ($url !== '' && parse_url($url, PHP_URL_SCHEME) === null) {
            $url = 'https://' . $url;
        }
        // only web addresses: a javascript: or data: link would run when someone clicks it
        if (filter_var($url, FILTER_VALIDATE_URL) === false || !in_array(strtolower((string) parse_url($url, PHP_URL_SCHEME)), array('http', 'https'), true) || mb_substr($url, 0, 2048) !== $url) {
            throw new ImproperActionException(_('Please enter a valid web address (http or https).'));
        }
        $sql = 'INSERT INTO custom_other_links (team, userid, title, url, description) VALUES (:team, :userid, :title, :url, :description)';
        $req = $this->Db->prepare($sql);
        $req->bindValue(':team', $this->requester->team, PDO::PARAM_INT);
        $req->bindValue(':userid', $this->requester->userData['userid'], PDO::PARAM_INT);
        $req->bindValue(':title', $title);
        $req->bindValue(':url', $url);
        $req->bindValue(':description', mb_substr(trim($description), 0, 1000));
        $this->Db->execute($req);
        return $this->Db->lastInsertId();
    }

    public function destroy(int $id): bool
    {
        $sql = 'DELETE FROM custom_other_links WHERE id = :id AND team = :team';
        if ((int) ($this->requester->userData['is_admin'] ?? 0) !== 1 && (int) ($this->requester->userData['is_sysadmin'] ?? 0) !== 1) {
            $sql .= ' AND userid = :userid';
        }
        $req = $this->Db->prepare($sql);
        $req->bindValue(':id', $id, PDO::PARAM_INT);
        $req->bindValue(':team', $this->requester->team, PDO::PARAM_INT);
        if (str_contains($sql, ':userid')) {
            $req->bindValue(':userid', $this->requester->userData['userid'], PDO::PARAM_INT);
        }
        return $this->Db->execute($req);
    }
}
