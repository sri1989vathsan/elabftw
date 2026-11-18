<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2026 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Models;

use Elabftw\Elabftw\Db;
use Elabftw\Enums\State;
use Elabftw\Models\Users\Users;
use PDO;

/**
 * The small counters on the dashboard. They only ever count the requester's own, non deleted experiments, so there is no
 * permission to check per row, and each is one prepared query that is served by an existing index
 * (experiments: userid/state/modified_at and status, experiments_steps: item_id/finished).
 */
final class DashboardStats
{
    private Db $Db;

    public function __construct(private Users $Users)
    {
        $this->Db = Db::getConnection();
    }

    /**
     * My experiments by status: status id (0 for "not set") => count
     *
     * @return array<int, int>
     */
    public function experimentsByStatus(): array
    {
        $req = $this->Db->prepare(
            'SELECT COALESCE(status, 0) AS status_id, COUNT(*) AS n
            FROM experiments
            WHERE userid = :userid AND state = :state
            GROUP BY status_id',
        );
        $req->bindValue(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':state', State::Normal->value, PDO::PARAM_INT);
        $this->Db->execute($req);
        $out = array();
        foreach ($req->fetchAll() as $row) {
            $out[(int) $row['status_id']] = (int) $row['n'];
        }
        return $out;
    }

    /**
     * My resources by status: status id (0 for "not set") => count. Only the requester's own, non deleted resources.
     *
     * @return array<int, int>
     */
    public function resourcesByStatus(): array
    {
        $req = $this->Db->prepare(
            'SELECT COALESCE(status, 0) AS status_id, COUNT(*) AS n
            FROM items
            WHERE userid = :userid AND state = :state
            GROUP BY status_id',
        );
        $req->bindValue(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':state', State::Normal->value, PDO::PARAM_INT);
        $this->Db->execute($req);
        $out = array();
        foreach ($req->fetchAll() as $row) {
            $out[(int) $row['status_id']] = (int) $row['n'];
        }
        return $out;
    }

    /** How many of my resources were modified in the last seven days */
    public function resourcesModifiedThisWeek(): int
    {
        $req = $this->Db->prepare(
            'SELECT COUNT(*) FROM items
            WHERE userid = :userid AND state = :state AND modified_at >= (NOW() - INTERVAL 7 DAY)',
        );
        $req->bindValue(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':state', State::Normal->value, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $req->fetchColumn();
    }

    /** How many of my experiments were modified in the last seven days */
    public function modifiedThisWeek(): int
    {
        $req = $this->Db->prepare(
            'SELECT COUNT(*) FROM experiments
            WHERE userid = :userid AND state = :state AND modified_at >= (NOW() - INTERVAL 7 DAY)',
        );
        $req->bindValue(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':state', State::Normal->value, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $req->fetchColumn();
    }

    /** Unfinished steps on my own experiments */
    public function openSteps(): int
    {
        $req = $this->Db->prepare(
            'SELECT COUNT(*) FROM experiments_steps AS st
            INNER JOIN experiments AS e ON e.id = st.item_id
            WHERE e.userid = :userid AND e.state = :state AND st.finished = 0',
        );
        $req->bindValue(':userid', $this->Users->userid, PDO::PARAM_INT);
        $req->bindValue(':state', State::Normal->value, PDO::PARAM_INT);
        $this->Db->execute($req);
        return (int) $req->fetchColumn();
    }
}
