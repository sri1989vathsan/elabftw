/**
 * @author Nicolas CARPi / Deltablot
 * @copyright 2026 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

/**
 * Code related to the entities table present on the index page
 */
import {
  ClientSideRowModelModule,
  ColumnApiModule,
  ModuleRegistry,
  PaginationModule,
  RowSelectionModule,
  TextFilterModule,
  provideGlobalGridOptions,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiC } from './api';
import i18next from './i18n';
import { DEFAULT_AG_GRID_PAGINATION, getEntityTypeFromPage } from './misc';
import { getAgGridTheme } from "./theme";

const COLUMN_STATE_STORAGE_KEY = 'persistent_entities_table_column_state_v1';

// allow filtering by displayed values for cells that render their raw value differently
const yesNo = v => v === 1 ? i18next.t('yes') : i18next.t('no');
const lastLoginText = v => v === null ? i18next.t('never') : v;
let entitiesTableRoot = null;

const URL_RE = /^https?:\/\/\S+$/i;

// the locations of a resource, each a link to the storage browser opened on it
const LocationsRenderer = ({ data }) => (data.storage_locations ?? []).map((l, i) => (
  <span key={l.container_id ?? i}>
    {i > 0 && ' | '}
    <a href={`?storage_unit=${l.storage_id}`} onClick={event => event.stopPropagation()}>{l.path}</a>
    {l.position && <span className='color-medium'>{` · ${l.position}`}</span>}
  </span>
));

// a web address in a custom field becomes a link to it
const WebAddressRenderer = ({ value }) => (
  URL_RE.test(value ?? '')
    ? <a href={value} target='_blank' rel='noopener noreferrer' onClick={event => event.stopPropagation()}>{value}</a>
    : value
);

const normalizeStringParam = value => {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
};

const normalizeNumberParam = value => {
  const stringValue = normalizeStringParam(value);

  if (stringValue.length === 0) {
    return null;
  }

  const numberValue = Number(stringValue);

  return Number.isFinite(numberValue) ? numberValue : null;
};

const applyStringParamFallback = (params, param, fallback) => {
  if ((params.get(param) ?? '').length > 0) {
    return;
  }

  const value = normalizeStringParam(fallback);

  if (value.length > 0) {
    params.set(param, value);
  }
};

const applyNumberParamFallback = (params, param, fallback) => {
  const urlValue = params.get(param);

  if (urlValue !== null && urlValue.length > 0) {
    const numberValue = normalizeNumberParam(urlValue);

    if (numberValue === null) {
      params.delete(param);
      return;
    }

    params.set(param, String(numberValue));
    return;
  }

  const value = normalizeNumberParam(fallback);

  if (value !== null) {
    params.set(param, String(value));
  }
};

const getStoredColumnState = () => {
  try {
    return JSON.parse(
      localStorage.getItem(COLUMN_STATE_STORAGE_KEY) ?? 'null'
    );
  } catch {
    return null;
  }
};

const storeColumnState = api => {
  try {
    localStorage.setItem(
      COLUMN_STATE_STORAGE_KEY,
      JSON.stringify(api.getColumnState())
    );
  } catch {
    // localStorage might be unavailable
  }
};

const getEntityFilterParams = event => {
  const detail = event?.detail;

  if (detail instanceof URLSearchParams) {
    return new URLSearchParams(detail);
  }

  if (typeof detail === 'string') {
    return new URLSearchParams(detail);
  }

  if (detail?.params) {
    return new URLSearchParams(detail.params);
  }

  if (detail?.search) {
    return new URLSearchParams(detail.search);
  }

  return new URLSearchParams(document.location.search);
};

const rowSelection = {
  mode: 'multiRow',
  headerCheckbox: true,
  selectAll: 'currentPage',
};

const EntitiesTable = ({
  selectedEntities,
  order = 'date',
  sort = 'desc',
  related = null,
  relatedOrigin = '',
}) => {
  const [rowData, setRowData] = useState([]);

  const onGridReady = event => {
    const columnState = getStoredColumnState();

    if (Array.isArray(columnState)) {
      event.api.applyColumnState({
        state: columnState,
        applyOrder: true,
      });
    }
    // a column state saved before the ID was pinned must not take it out of sight
    event.api.applyColumnState({ state: [{ colId: 'id', pinned: 'left' }] });
    event.api.moveColumns(['id'], 0);
    fetchData();
  };

  const columnStateChanged = event => {
    if (event.finished === false) {
      return;
    }

    storeColumnState(event.api);
  };

  const PastDateRenderer = ({ value }) => {
    return value === i18next.t('never')
      ? <span className='font-italic'>{value}</span>
      : <span>{value}</span>;
  };

  const BinaryRenderer = ({ value }) => {
    return value === i18next.t('yes')
      ? <span title={value}><i className='fas fa-circle-check mr-2'></i>{value}</span>
      : <span title={value}><i className='fas fa-circle-xmark mr-2'></i>{value}</span>;
  };

  const RatingsRenderer = ({ value }) => {
    return Number(value) > 0
      ? <span className='rating-show rounded p-1 font-weight-bold'><i className='fas fa-star mr-1' aria-hidden='true'></i>{value}</span>
      : null;
  };

  const TagsRenderer = ({ value }) => {
    const tags = Array.isArray(value) ? value : [];

    if (tags.length === 0) {
      return null;
    }

    return (
      <span className='d-flex flex-wrap'>
        {tags.map(tagData => {
          const params = new URLSearchParams();
          params.set('mode', 'show');
          params.append('tags[]', tagData.tag);

          return (
            <a
              key={tagData.id ?? tagData.tag}
              className={`tag margin-1px${tagData.is_favorite ? ' favorite' : ''}`}
              href={`${window.location.pathname}?${params.toString()}`}
              onClick={event => event.stopPropagation()}
            >
              {tagData.tag}
            </a>
          );
        })}
      </span>
    );
  };

  // resources only: where the item is stored and how much of it, as in an inventory sheet
  const isResourcesPage = window.location.pathname.split('/').pop() === 'database.php';
  const storageLocations = p => p.data.storage_locations ?? [];
  const storageColumns = [
    {
      field: 'storage_path',
      headerName: i18next.t('location', { defaultValue: 'Location' }),
      valueGetter: p => storageLocations(p).map(l => `${l.path} ${l.position ?? ''}`.trim()).join(' | '),
      cellRenderer: LocationsRenderer,
    },
    {
      field: 'storage_qty',
      headerName: i18next.t('quantity', { defaultValue: 'Quantity' }),
      valueGetter: p => storageLocations(p).map(l => `${l.qty_stored} ${l.qty_unit}`.trim()).join(' | '),
    },
  ];

  const baseColumns = [
    // the ID is what is looked for first: it comes first and stays in view when the table is scrolled
    { field: 'id', headerName: i18next.t('id'), pinned: 'left', width: 90 },
    { field: 'title', headerName: i18next.t('title') },
    { field: 'team_name', headerName: i18next.t('team') },
    { field: 'date', headerName: i18next.t('started-on'), valueGetter: p => lastLoginText(p.data.date), filterValueGetter: p => lastLoginText(p.data.date), cellRenderer: PastDateRenderer},
    { field: 'category', headerName: i18next.t('category'), valueGetter: p => p.data.category_title },
    ...(isResourcesPage ? storageColumns : []),
    { field: 'status', headerName: i18next.t('status'), valueGetter: p => p.data.status_title },
    { field: 'tags_decoded', headerName: i18next.t('tags'), valueGetter: p => p.data.tags_decoded, filterValueGetter: p => p.data.tags_decoded?.map(tagData => tagData.tag).join(' ') ?? '', cellRenderer: TagsRenderer },
    { field: 'custom_id', headerName: i18next.t('custom-id') },
    { field: 'fullname', headerName: i18next.t('owner') },
    { field: 'timestamped', headerName: i18next.t('is-timestamped'), valueGetter: p => yesNo(p.data.timestamped), filterValueGetter: p => yesNo(p.data.timestamped), cellRenderer: BinaryRenderer },
    { field: 'modified_at', headerName: i18next.t('last-modified-at'), valueGetter: p => p.data.modified_at },
    { field: 'locked', headerName: i18next.t('is-locked'), valueGetter: p => yesNo(p.data.locked), filterValueGetter: p => yesNo(p.data.locked), cellRenderer: BinaryRenderer },
    { field: 'rating', headerName: i18next.t('rating'), cellRenderer: RatingsRenderer },
    { field: 'next_step', headerName: i18next.t('next-step'),  cellRenderer: ({ value }) => value ? value.split('|')[0] : null }
  ];

  // when the list holds a single category (the category tab bar), add one column per extra field of that category
  const columnDefs = useMemo(() => {
    const categories = new Set(rowData.map(row => row.category));
    if (!isResourcesPage || categories.size !== 1) {
      return baseColumns;
    }
    const names = [];
    rowData.forEach(row => (row.extra_fields ?? []).forEach(f => {
      if (!names.includes(f.name)) {
        names.push(f.name);
      }
    }));
    const extraColumns = names.map(name => ({
      colId: `extra_${name}`,
      headerName: name,
      valueGetter: p => (p.data.extra_fields ?? []).find(f => f.name === name)?.value ?? '',
      cellRenderer: WebAddressRenderer,
    }));
    // placed right after the title so the data of the category comes first, like in an inventory sheet
    return [baseColumns[0], baseColumns[1], ...extraColumns, ...baseColumns.slice(2)];
  }, [rowData]);

  const getResolvedEntityFilterParams = useCallback(event => {
    const params = getEntityFilterParams(event);

    applyStringParamFallback(params, 'order', order);
    applyStringParamFallback(params, 'sort', sort);
    applyNumberParamFallback(params, 'related', related);
    applyStringParamFallback(params, 'related_origin', relatedOrigin);

    return params;
  }, [order, sort, related, relatedOrigin]);

  // all the entries are loaded in the table, which does client side pagination
  const fetchData = useCallback(async event => {
    const params = getResolvedEntityFilterParams(event);
    const queryString = params.toString();

    try {
      const endpoint = getEntityTypeFromPage(window.location);
      const url = queryString ? `${endpoint}?${queryString}` : endpoint;
      const entities = await ApiC.getJson(url, {notifOnError: 0});
      setRowData(entities);
    } catch (error) {
      console.error(`Could not load entities: ${error}`);
    }
  }, [getResolvedEntityFilterParams]);

  const getRowId = useCallback(params => String(params.data.id), []);

  const processRowPostCreate = useCallback(params => {
    if (params.node.data?.id) {
      params.eRow.dataset.entityId = String(params.node.data.id);
    }
  }, []);

  // Load data on component mount and reload when entity filters change
  useEffect(() => {
    const handleEntityFiltersChanged = event => {
      fetchData(event);
    };

    window.addEventListener('entity-filters-changed', handleEntityFiltersChanged);

    return () => {
      window.removeEventListener('entity-filters-changed', handleEntityFiltersChanged);
    };
  }, [fetchData]);

  // when a row is selected with the checkbox
  const selectionChanged = (event) => {
    const selectedRows = event.api.getSelectedRows();
    const selectedIds = selectedRows.map(row => String(row.id));

    selectedEntities?.set(selectedIds);

    const withSelected = document.getElementById('withSelected');
    if (!withSelected) {
      return;
    }

    if (selectedIds.length > 0) {
      withSelected.removeAttribute('hidden');
    } else {
      withSelected.setAttribute('hidden', 'hidden');
    }
  };

  const defaultColDef = useMemo(() => {
    return {
      filter: 'agTextColumnFilter',
      floatingFilter: true,
    };
  }, []);

  const cellClicked = event => {
    const target = event.event?.target;
    const url = `?mode=view&id=${encodeURIComponent(event.data.id)}`;

    if (
      target instanceof HTMLElement
      && target.closest('input, button, a, .ag-selection-checkbox')
    ) {
      return;
    }
    if (event.event?.ctrlKey || event.event?.metaKey) {
      window.open(url, '_blank');
      return;
    }
    window.location = url;
  };

  return (
    <>
      <div
        className={getAgGridTheme()} style={{ height: 650 }}>
        <AgGridReact
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={getRowId}
          processRowPostCreate={processRowPostCreate}
          onColumnResized={columnStateChanged}
          onColumnMoved={columnStateChanged}
          onColumnVisible={columnStateChanged}
          onColumnPinned={columnStateChanged}
          onSortChanged={columnStateChanged}
          onGridReady={onGridReady}
          rowSelection={rowSelection}
          onCellClicked={cellClicked}
          onSelectionChanged={selectionChanged}
          {...DEFAULT_AG_GRID_PAGINATION}
        />
      </div>
    </>
  );
};

const App = ({ selectedEntities, order, sort, related, relatedOrigin }) => (
  <EntitiesTable
    selectedEntities={selectedEntities}
    order={order}
    sort={sort}
    related={related}
    relatedOrigin={relatedOrigin}
  />
);

export const mountEntitiesTable = (
  rootElement,
  selectedEntities,
  order = 'date',
  sort = 'desc',
  related = null,
  relatedOrigin = '',
) => {
  if (!rootElement) {
    return null;
  }

  provideGlobalGridOptions({ theme: 'legacy' });
  ModuleRegistry.registerModules([
    ClientSideRowModelModule,
    ColumnApiModule,
    RowSelectionModule,
    PaginationModule,
    TextFilterModule,
  ]);

  if (!entitiesTableRoot) {
    entitiesTableRoot = createRoot(rootElement);
  }

  entitiesTableRoot.render(
    <App
      selectedEntities={selectedEntities}
      order={order}
      sort={sort}
      related={related}
      relatedOrigin={relatedOrigin}
    />
  );

  return entitiesTableRoot;
};

export const unmountEntitiesTable = () => {
  if (!entitiesTableRoot) {
    return;
  }

  entitiesTableRoot.unmount();
  entitiesTableRoot = null;
};
