/** Fork-owned TinyMCE button for inserting links to PyRAT mice. */
import { Editor } from 'tinymce/tinymce';
import { escapeHTML } from '../misc';

interface PyratAnimal {
  id: string;
  animal_id: string;
  cage: string;
  sex: string;
  strain: string;
  genotype: string;
  status: string;
  project: string;
}

interface PyratResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface MouseSearchDialogData {
  searchMode: 'mouse' | 'cage';
  query: string;
}

interface LinkResultDialogData {
  target: string;
}

interface LinkTarget {
  label: string;
  text: string;
  url: string;
}

function mouseId(animal: PyratAnimal): string {
  return String(animal.id || animal.animal_id || '').trim();
}

function mouseLabel(animal: PyratAnimal): string {
  return String(animal.animal_id || animal.id || '').trim();
}

function getMouseUrl(animal: PyratAnimal): string {
  const params = new URLSearchParams({
    tab: 'animals',
    q: mouseLabel(animal),
  });
  return `animal-studies.php?${params.toString()}`;
}

function getCageUrl(cageId: string): string {
  const params = new URLSearchParams({
    tab: 'cages',
    q: cageId,
  });
  return `animal-studies.php?${params.toString()}`;
}

function describeMouse(animal: PyratAnimal): string {
  const details = [
    animal.cage ? `cage ${animal.cage}` : '',
    animal.strain,
    animal.genotype,
    animal.sex,
    animal.status,
  ].filter(Boolean);
  const label = mouseLabel(animal) || mouseId(animal);
  return details.length > 0 ? `${label} — ${details.join(' · ')}` : label;
}

async function searchAnimals(mode: 'mouse' | 'cage', query: string): Promise<PyratAnimal[]> {
  const params = new URLSearchParams({action: 'animals'});
  params.set(mode === 'cage' ? 'cage' : 'q', query);
  const response = await fetch(`app/controllers/PyratAjaxController.php?${params.toString()}`, {
    headers: {Accept: 'application/json'},
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const payload = await response.json() as PyratResponse<PyratAnimal[]>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `PyRAT request failed (${response.status})`);
  }
  const animals = payload.data ?? [];
  if (mode === 'cage') return animals;

  // The server's general search also covers strain, project and status. Keep
  // this dedicated toolbar search restricted to mouse identifiers.
  const normalizedQuery = query.toLocaleLowerCase();
  return animals.filter(animal => [animal.id, animal.animal_id]
    .some(value => String(value ?? '').toLocaleLowerCase().includes(normalizedQuery)));
}

export function registerMouseLinkExtension(editor: Editor): void {
  const openDialog = (): void => {
    const bookmark = editor.selection.getBookmark(2, true);
    const hasSelection = !editor.selection.getRng().collapsed;

    const openResults = (animals: PyratAnimal[], searchDescription: string): void => {
      const usableAnimals = animals.filter(animal => mouseLabel(animal));
      if (usableAnimals.length === 0) {
        editor.notificationManager.open({
          text: `No mice found for ${searchDescription}.`,
          type: 'info',
          timeout: 3000,
        });
        return;
      }

      const targets: LinkTarget[] = usableAnimals.slice(0, 100).map(animal => ({
        label: `Mouse ${mouseLabel(animal)}`,
        text: describeMouse(animal),
        url: getMouseUrl(animal),
      }));
      const seenCages = new Set<string>();
      for (const animal of usableAnimals) {
        const cageId = String(animal.cage ?? '').trim();
        if (!cageId || seenCages.has(cageId)) continue;
        seenCages.add(cageId);
        targets.push({
          label: `Cage ${cageId}`,
          text: `Cage ${cageId}`,
          url: getCageUrl(cageId),
        });
      }

      editor.windowManager.open({
        title: 'Insert PyRAT link',
        size: 'normal',
        body: {
          type: 'panel',
          items: [
            {
              type: 'selectbox',
              name: 'target',
              label: `${usableAnimals.length} matching ${usableAnimals.length === 1 ? 'mouse' : 'mice'}; choose a mouse or cage link`,
              items: targets.map((target, index) => ({
                text: target.text,
                value: String(index),
              })),
            },
          ],
        },
        initialData: {target: '0'},
        buttons: [
          {type: 'cancel', text: 'Cancel'},
          {type: 'submit', text: 'Insert link', primary: true},
        ],
        onSubmit: api => {
          const data = api.getData() as LinkResultDialogData;
          const target = targets[Number(data.target)];
          if (!target) return;
          editor.focus();
          editor.selection.moveToBookmark(bookmark);
          editor.undoManager.transact(() => {
            if (hasSelection) {
              editor.execCommand('mceInsertLink', false, {href: target.url});
              return;
            }
            editor.execCommand(
              'mceInsertContent',
              false,
              `<a href="${escapeHTML(target.url)}">${escapeHTML(target.label)}</a>`,
            );
          });
          api.close();
        },
      });
    };

    editor.windowManager.open({
      title: 'Find a PyRAT mouse',
      size: 'normal',
      body: {
        type: 'panel',
        items: [
          {
            type: 'selectbox',
            name: 'searchMode',
            label: 'Search by',
            items: [
              {text: 'Mouse ID', value: 'mouse'},
              {text: 'Cage ID', value: 'cage'},
            ],
          },
          {
            type: 'input',
            name: 'query',
            label: 'Mouse or cage ID',
            placeholder: 'M1234 or C12',
          },
        ],
      },
      initialData: {searchMode: 'mouse', query: ''},
      buttons: [
        {type: 'cancel', text: 'Cancel'},
        {type: 'submit', text: 'Search', primary: true},
      ],
      onSubmit: api => {
        const data = api.getData() as MouseSearchDialogData;
        const query = data.query.trim();
        if (!query) {
          editor.notificationManager.open({
            text: `Enter a ${data.searchMode === 'cage' ? 'cage' : 'mouse'} ID.`,
            type: 'error',
            timeout: 2500,
          });
          return;
        }
        api.block('Searching PyRAT…');
        void searchAnimals(data.searchMode, query)
          .then(animals => {
            api.close();
            openResults(animals, `${data.searchMode === 'cage' ? 'cage' : 'mouse'} ID ${query}`);
          })
          .catch(error => {
            api.unblock();
            editor.notificationManager.open({
              text: error instanceof Error ? error.message : 'PyRAT search failed.',
              type: 'error',
              timeout: 4000,
            });
          });
      },
    });
  };

  // Simple mouse silhouette, kept separate from TinyMCE's regular link icon.
  editor.ui.registry.addIcon('pyrat-mouse', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 8.25C8.5 4.8 10.3 2 12.5 2s4 2.8 4 6.25v4.5c0 3.45-1.8 6.25-4 6.25s-4-2.8-4-6.25v-4.5Z" stroke="currentColor" stroke-width="1.8"/><path d="M12.5 2v5.5M12.5 7.5H8.8M16.2 7.5h1.3c2.5 0 4.5 2 4.5 4.5s-2 4.5-4.5 4.5h-1.7M10.5 21l2-2 2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10.5" cy="10" r=".8" fill="currentColor"/><circle cx="14.5" cy="10" r=".8" fill="currentColor"/></svg>');
  editor.ui.registry.addButton('insert-mouse', {
    icon: 'pyrat-mouse',
    tooltip: 'Insert PyRAT mouse link',
    onAction: openDialog,
  });
}
