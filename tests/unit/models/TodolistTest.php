<?php

declare(strict_types=1);
/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2022 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

namespace Elabftw\Models;

use Elabftw\Enums\Action;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Params\OrderingParams;

class TodolistTest extends \PHPUnit\Framework\TestCase
{
    private Todolist $Todolist;

    protected function setUp(): void
    {
        $this->Todolist = new Todolist(1);
    }

    public function testCreate(): void
    {
        $content = 'write more tests';
        $this->assertIsInt($this->Todolist->postAction(Action::Create, array('content' => $content)));
    }

    public function testRead(): void
    {
        $this->assertIsArray($this->Todolist->readAll());
    }

    public function testCreateCalendarTask(): void
    {
        $id = $this->Todolist->postAction(Action::Create, array(
            'content' => 'calibrate the microscope',
            'notes' => 'Bring the reference slide.',
            'deadline' => '2030-05-10T14:30:00+02:00',
            'reminder_minutes' => 60,
        ));
        $this->Todolist->setId($id);
        $task = $this->Todolist->readOne();
        $this->assertSame('calibrate the microscope', $task['body']);
        $this->assertSame('Bring the reference slide.', $task['notes']);
        $this->assertSame('2030-05-10T12:30:00Z', $task['deadline']);
        $this->assertSame(60, $task['reminder_minutes']);
    }

    public function testUpdate(): void
    {
        $this->Todolist->setId(1);
        $updated = $this->Todolist->patch(Action::Update, array(
            'content' => 'write way more tests',
            'deadline' => '2030-05-10T15:00:00Z',
            'reminder_minutes' => 15,
        ));
        $this->assertSame('2030-05-10T15:00:00Z', $updated['deadline']);
        $this->assertSame(15, $updated['reminder_minutes']);
    }

    public function testRejectInvalidReminder(): void
    {
        $this->expectException(ImproperActionException::class);
        $this->Todolist->postAction(Action::Create, array(
            'content' => 'invalid reminder',
            'deadline' => '2030-05-10T15:00:00Z',
            'reminder_minutes' => 10081,
        ));
    }

    public function testUpdateOrdering(): void
    {
        $this->Todolist->postAction(Action::Create, array('content' => 'item 2'));
        $this->Todolist->postAction(Action::Create, array('content' => 'item 3'));
        $this->Todolist->postAction(Action::Create, array('content' => 'item 4'));
        $OrderingParams = new OrderingParams(array('ordering' => array('test_3', 'test_2', 'test_1'), 'table' => 'todolist'));
        $this->Todolist->updateOrdering($OrderingParams);
        $all = $this->Todolist->readAll();
        $this->assertEquals('item 4', $all[0]['body']);
    }

    public function testDestroy(): void
    {
        $this->assertTrue($this->Todolist->destroy());
    }
}
