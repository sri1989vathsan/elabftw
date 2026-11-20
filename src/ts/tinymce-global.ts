/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 *
 * TinyMCE (about 1 MB with its plugins and our editor extensions) is not part of main.bundle.js: only the pages that have an editor load it
 * (Editor.class.ts and the readme editor of the folders explorer import it on demand, edit.ts and sysconfig.ts bring it with their chunk).
 * Code that runs on every page and only ever *looks* at an editor that already exists (the Contents panel, the command palette, the save
 * bookkeeping) reads it from here: the same `tinymce` object once it was loaded, nothing before that, exactly like the old
 * `tinymce.get(id)` / `tinymce.activeEditor` on a page without an editor.
 */
import type { Editor } from 'tinymce/tinymce';

type TinyMce = {
  get(id: string | number): Editor | null;
  activeEditor: Editor | null;
};

function loaded(): TinyMce | undefined {
  return (window as typeof window & { tinymce?: TinyMce }).tinymce;
}

export const tinymce = {
  get(id: string | number): Editor | null {
    return loaded()?.get(id) ?? null;
  },
  get activeEditor(): Editor | null {
    return loaded()?.activeEditor ?? null;
  },
};

/** The full tinymce object and our configuration for it, loaded when first needed (one extra chunk, shared with edit.ts and sysconfig.ts). */
export async function loadTinymce(): Promise<{ tinymce: typeof import('tinymce/tinymce').default; getTinymceBaseConfig: (page: string) => object }> {
  const [{ default: lib }, { getTinymceBaseConfig }] = await Promise.all([
    import(/* webpackChunkName: 'tinymce-editor' */ 'tinymce/tinymce'),
    import(/* webpackChunkName: 'tinymce-editor' */ './tinymce'),
  ]);
  return { tinymce: lib, getTinymceBaseConfig };
}
