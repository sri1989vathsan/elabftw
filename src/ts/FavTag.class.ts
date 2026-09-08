/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import { Model } from './interfaces';
import { ApiC } from './api';

export default class FavTag {
  // ADD A TAG AS FAVORITE
  create(content: string): Promise<Response> {
    return ApiC.post(Model.FavTag, {tag: content });
  }
}
