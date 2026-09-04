/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2023 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

export interface ValidMetadata {
  elabftw?: MetadataElabftw,
  extra_fields: ExtraField,
}

export interface ExtraField {
  [key: string]: ExtraFieldProperties,
}

export enum ExtraFieldInputType {
  Checkbox = 'checkbox',
  Compounds = 'compounds',
  Date = 'date',
  DateTime = 'datetime-local',
  Email = 'email',
  Experiments = 'experiments',
  Number = 'number',
  Radio = 'radio',
  Items = 'items',
  Select = 'select',
  Text = 'text',
  Time = 'time',
  Uploads = 'uploads',
  Users = 'users',
  Url = 'url',
}

export interface ExtraFieldProperties {
  type?: ExtraFieldInputType;
  value: string|string[]|number;
  group_id?: number;
  position?: number;
  options?: string[];
  description?: string;
  allow_multi_values?: boolean;
  required?: boolean;
  unit?: string;
  units?: string[];
  readonly?: boolean;
  element?: HTMLElement;
}

export interface MetadataElabftw {
  extra_fields_groups?: Array<ExtraFieldsGroup>,
  file_folder_references?: Array<FileFolderReference>,
  web_links?: Array<WebLink>,
  labcollector_links?: Array<WebLink>,
  template_version_docs?: Record<string, {label: string, notes: string}>,
}

export interface FileFolderReference {
  id: string,
  text: string,
  label?: string,
}

export interface WebLink {
  id: string,
  label: string,
  url: string,
}

export interface ExtraFieldsGroup {
  id: number,
  name: string,
}
