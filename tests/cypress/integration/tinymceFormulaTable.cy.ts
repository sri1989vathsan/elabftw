describe('TinyMCE formula tables', () => {
  const getEditorBody = () => cy
    .get<HTMLIFrameElement>('iframe.tox-edit-area__iframe')
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then(cy.wrap);

  beforeEach(() => {
    cy.login();
  });

  it('calculates, edits, and persists formulas in a Main Text table', () => {
    cy.createEntity('experiment', 'Cypress formula table experiment').then(() => {
      getEditorBody().then(body => {
        body.html(`
          <table>
            <tbody>
              <tr><th>Item</th><th>Quantity</th><th>Price</th><th>Total</th></tr>
              <tr><td>Buffer</td><td>2</td><td>12.5</td><td><br></td></tr>
              <tr><td>Tubes</td><td>5</td><td>3</td><td><br></td></tr>
              <tr><th>Grand total</th><td></td><td></td><th><br></th></tr>
            </tbody>
          </table>
          <p>Notes</p>
        `);
      });

      getEditorBody().find('tr').eq(1).find('td').eq(3).click().type('=B2*C2');
      getEditorBody().find('tr').eq(2).find('td').eq(3).click().type('=B3*C3');
      getEditorBody().find('tr').eq(3).find('th').eq(1).click().type('=SUM(D2:D3)');
      getEditorBody().find('p').click();

      getEditorBody().find('tr').eq(1).find('td').eq(3)
        .should('have.text', '25')
        .and('have.attr', 'data-formula', '=B2*C2');
      getEditorBody().find('tr').eq(2).find('td').eq(3)
        .should('have.text', '15');
      getEditorBody().find('tr').eq(3).find('th').eq(1)
        .should('have.text', '40')
        .and('have.attr', 'data-formula-state', 'valid');

      // Selecting a calculated cell reveals its editable formula.
      getEditorBody().find('tr').eq(3).find('th').eq(1).click()
        .should('have.text', '=SUM(D2:D3)');

      cy.get('[data-action="update-entity-body"][data-redirect="view"]').click();
      cy.url().should('include', 'mode=view');

      cy.get('#body_view tr').eq(3).find('th').eq(1)
        .should('have.text', '40')
        .and('have.attr', 'data-formula', '=SUM(D2:D3)');

      cy.get('button[title="More options"]').click()
        .get('button[data-action="destroy"]').click();
    });
  });

  it('inserts a well-plate spreadsheet with well-aware references', () => {
    cy.createEntity('experiment', 'Cypress formula well plate').then(() => {
      cy.get('button[title="Insert spreadsheet table"]').click();
      cy.get('.tox-collection__item-label')
        .contains('96-well plate (8 × 12)')
        .click();

      getEditorBody().find('table[data-well-plate="96"]').within(() => {
        cy.get('tr').should('have.length', 9);
        cy.get('tr').eq(0).find('th').should('have.length', 13);
        cy.get('tr').eq(1).find('th').should('have.text', 'A');
        cy.get('tr').eq(8).find('th').should('have.text', 'H');
      });

      // In well-plate tables A1 and B1 refer to wells, not their labels.
      getEditorBody().find('table[data-well-plate="96"] tr').eq(1).find('td').eq(0).click().type('2');
      getEditorBody().find('table[data-well-plate="96"] tr').eq(1).find('td').eq(1).click().type('3');
      getEditorBody().find('table[data-well-plate="96"] tr').eq(1).find('td').eq(2).click().type('=SUM(A1:B1)');
      getEditorBody().click(5, 5);

      getEditorBody().find('table[data-well-plate="96"] tr').eq(1).find('td').eq(2)
        .should('have.text', '5')
        .and('have.attr', 'data-formula', '=SUM(A1:B1)');

      cy.get('[data-action="update-entity-body"][data-redirect="view"]').click();
      cy.get('#body_view table[data-well-plate="96"] tr').eq(1).find('td').eq(2)
        .should('have.text', '5')
        .and('have.attr', 'data-formula', '=SUM(A1:B1)');

      cy.get('button[title="More options"]').click()
        .get('button[data-action="destroy"]').click();
    });
  });

  it('mounts the attachment spreadsheet editor and loads every workbook sheet', () => {
    cy.createEntity('experiment', 'Cypress workbook editor').then(() => {
      cy.get<HTMLIFrameElement>('#spreadsheetIframe').should('exist').then($iframe => {
        const iframe = $iframe[0];
        cy.wrap(iframe.contentDocument?.getElementById('spreadsheetEditorRoot'))
          .should('not.be.null')
          .children()
          .should('have.length.greaterThan', 0);

        iframe.contentWindow?.postMessage({
          type: 'jss-load-workbook',
          detail: {
            name: 'multi-sheet.xlsx',
            uploadId: 42,
            worksheets: [
              { name: 'Measurements', data: [[1], [2], ['=SUM(A1:A2)']] },
              { name: 'Notes', data: [['second sheet']] },
            ],
          },
        }, window.location.origin);
      });

      cy.get<HTMLIFrameElement>('#spreadsheetIframe')
        .its('0.contentDocument.body')
        .should('contain.text', 'Measurements')
        .and('contain.text', 'Notes');

      cy.get('button[title="More options"]').click()
        .get('button[data-action="destroy"]').click();
    });
  });

  it('inserts workbook sheets into Main Text with formulas retained', () => {
    cy.createEntity('experiment', 'Cypress workbook to main text').then(() => {
      cy.get<HTMLIFrameElement>('#spreadsheetIframe').then($iframe => {
        const iframe = $iframe[0];
        iframe.contentWindow?.postMessage({
          type: 'jss-load-workbook',
          detail: {
            worksheets: [
              { name: 'Measurements', data: [[1], [2], ['=SUM(A1:A2)']] },
              { name: 'Notes', data: [['retained']] },
            ],
          },
        }, window.location.origin);
      });

      cy.get<HTMLIFrameElement>('#spreadsheetIframe')
        .its('0.contentDocument.body')
        .find('[title="Insert workbook into main text"]')
        .click();

      getEditorBody().find('table.elabftw-spreadsheet').should('have.length', 2);
      getEditorBody().find('table.elabftw-spreadsheet').eq(0).within(() => {
        cy.get('caption').should('have.text', 'Measurements');
        cy.get('tbody tr').eq(2).find('td').eq(0).should('have.text', '3');
      }).then($table => {
        const encoded = $table.attr('data-spreadsheet');
        expect(encoded).to.be.a('string').and.not.be.empty;
        const raw = JSON.parse(decodeURIComponent(escape(atob(encoded))));
        expect(raw.data[2][0]).to.equal('=SUM(A1:A2)');
      });

      cy.get('button[title="More options"]').click()
        .get('button[data-action="destroy"]').click();
    });
  });
});
