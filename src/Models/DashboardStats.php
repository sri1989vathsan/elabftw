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

    /** Open to-do tasks assigned to me (not completed, not archived), the same rule as the sidebar To-do */
    public function openTasks(): int
    {
        $req = $this->Db->prepare(
            'SELECT COUNT(*) FROM todolist_task_assignees AS ta
            INNER JOIN todolist AS t ON t.id = ta.task_id
            WHERE ta.userid = :userid AND t.completed_at IS NULL AND t.archived_at IS NULL',
        );
        $req->bindValue(':userid', $this->Users->userid, PDO::PARAM_INT);
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
