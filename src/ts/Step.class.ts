/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import { Model, Target, Action } from './interfaces';
import type { Entity } from './interfaces';
import { ApiC } from './api';
import { getEditor } from './Editor.class';
import { beginEntitySave, endEntitySave } from './misc';

export default class Step {
  entity: Entity;
  model: Model;

  constructor(entity: Entity) {
    this.entity = entity;
    this.model = Model.Step;
  }

  // Feeds the same "Saved/Saving/Unsaved" indicator as the main entity body
  // (see beginEntitySave/endEntitySave in misc.ts) -- every step action goes
  // through this so task/step details are covered without wrapping each
  // method below individually.
  private tracked(request: Promise<Response>): Promise<Response> {
    beginEntitySave();
    return request.then(response => {
      endEntitySave('saved');
      return response;
    }).catch((error: unknown) => {
      endEntitySave('error');
      throw error;
    });
  }

  create(content: string): Promise<Response> {
    return this.tracked(ApiC.post(`${this.entity.type}/${this.entity.id}/${this.model}`, {body: content}));
  }

  update(id: number, content: string|null, target = Target.Body): Promise<Response> {
    const params = {};
    params[target] = content;
    // if we edit the body of the step, also change it in the editor body
    if (target === Target.Body) {
      const editor = getEditor();
      // read the old step and replace it in the entity body
      ApiC.getJson(`${this.entity.type}/${this.entity.id}/${this.model}/${id}`).then(json => {
        editor.replaceContent(editor.getContent().replace(json.body, content));
      });
    }
    if (target === Target.Deadline && content === null) {
      this.notifDestroy(id);
    }
    return this.tracked(ApiC.patch(`${this.entity.type}/${this.entity.id}/${this.model}/${id}`, params));
  }

  finish(id: number): Promise<Response> {
    return this.genericPatch(id, Action.Finish);
  }

  notif(id: number): Promise<Response> {
    return this.genericPatch(id, Action.Notif);
  }

  notifDestroy(id: number): Promise<Response> {
    return this.genericPatch(id, Action.NotifDestroy);
  }

  genericPatch(id: number, action: Action): Promise<Response> {
    return this.tracked(ApiC.patch(`${this.entity.type}/${this.entity.id}/${this.model}/${id}`, {action}));
  }

  destroy(id: number): Promise<Response> {
    return this.tracked(ApiC.delete(`${this.entity.type}/${this.entity.id}/${this.model}/${id}`));
  }
}
