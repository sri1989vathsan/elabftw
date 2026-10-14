/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import { ApiC } from './api';
import { entity } from './getEntity';
import { on } from './handlers';
import { Action } from './interfaces';
import { activateLazySpreadsheetViews } from './inline-spreadsheet';
import './comments';

on('override-exclusive-edit-lock', () => {
  ApiC.patch(`${entity.type}/${entity.id}`, { action: Action.RemoveExclusiveEditMode })
    .then(() => window.location.href = `?mode=view&id=${entity.id}`);
});

// add the title in the page name (see #324)
const titleElement = document.getElementById('documentTitle');
document.title = titleElement?.textContent ? `${titleElement.textContent} - eLabFTW` : 'eLabFTW';


// Upgrade any saved spreadsheet in the main text from its static HTML
// rendering to a real (read-only) jspreadsheet-ce grid as it scrolls into
// view (and back to static HTML once scrolled back out), so viewing
// matches the editing popup's own rendering exactly without every
// spreadsheet in a long document staying mounted for the rest of the
// page's life -- see activateLazySpreadsheetViews().
const bodyView = document.getElementById('body_view');
if (bodyView) activateLazySpreadsheetViews(bodyView);
