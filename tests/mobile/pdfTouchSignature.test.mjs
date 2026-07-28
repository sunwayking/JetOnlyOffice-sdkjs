/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const apiSource = readFileSync(new URL('../../pdf/api.js', import.meta.url), 'utf8');
const documentSource = readFileSync(new URL('../../pdf/src/document.js', import.meta.url), 'utf8');
const signatureSource = readFileSync(new URL('../../pdf/src/forms/signature.js', import.meta.url), 'utf8');

function extractFunction(source, marker, context = {}) {
    const markerIndex = source.indexOf(marker);
    assert.notEqual(markerIndex, -1, `missing source marker: ${marker}`);

    const functionIndex = source.indexOf('function', markerIndex);
    const bodyStart = source.indexOf('{', functionIndex);
    let depth = 0;

    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') {
            depth += 1;
        } else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                return vm.runInNewContext(`(${source.slice(functionIndex, index + 1)})`, context);
            }
        }
    }

    throw new Error(`unterminated function: ${marker}`);
}

function createSignatureField() {
    const history = [];
    const window = {
        AscPDF: {
            FIELD_TYPES: {signature: 33},
            APPEARANCE_TYPES: {normal: 0},
            CBaseField: function(sName, nType, aRect, oDoc) {
                this.name = sName;
                this.type = nType;
                this.rect = aRect;
                this.doc = oDoc;
                this.parentValue = undefined;
                this.defaultValue = undefined;
                this.needCommit = false;
                this.wasChanged = false;
                this.needRecalc = false;
                this.redraws = 0;
            }
        },
        AscFormat: {
            InitClass(child, parent) {
                Object.setPrototypeOf(child.prototype, parent.prototype);
            },
            CSignatureLine: function() {}
        },
        AscDFH: {historyitem_type_Pdf_Signature_Field: 1},
        AscCommon: {
            CommandType: {ctAnnotField: 164},
            History: {Add(change) { history.push(change); }}
        }
    };
    window.window = window;

    Object.assign(window.AscPDF.CBaseField.prototype, {
        GetDocument() { return this.doc; },
        GetAllWidgets() { return [this]; },
        GetFullName() { return this.name; },
        GetApIdx() { return 7; },
        GetMeta() { return this.meta || {}; },
        GetPage() { return 2; },
        GetRect() { return this.rect; },
        GetParent() { return null; },
        GetParentValue() { return this.parentValue; },
        SetParentValue(value) { this.parentValue = value; },
        GetDefaultValue() { return this.defaultValue; },
        SetNeedCommit(value) { this.needCommit = value; },
        SetWasChanged(value) { this.wasChanged = value; },
        SetNeedRecalc(value) { this.needRecalc = value; },
        AddToRedraw() { this.redraws += 1; },
        SetInForm(value) { this.inForm = value; },
        IsReadOnly() { return false; },
        IsHidden() { return false; },
        IsNeedDrawFromStream() { return false; },
        DrawBackground() {},
        DrawBorders() {},
        DrawLocks() {},
        DrawEdit() {},
        AddActionsToQueue() {},
        WriteToBinaryBase(memory) { memory.WriteByte(33); },
        WriteToBinaryBase2(memory) {
            memory.widgetFlags = 0;
            memory.posForWidgetFlags = memory.GetCurPosition();
            memory.Skip(4);
            memory.fieldDataFlags = 0;
            memory.posForFieldDataFlags = memory.GetCurPosition();
            memory.Skip(4);
        },
        CheckWidgetFlags() {}
    });

    const context = {
        window,
        AscPDF: window.AscPDF,
        AscFormat: window.AscFormat,
        AscDFH: window.AscDFH,
        AscCommon: window.AscCommon,
        CChangesPDFFormValue: function(field, oldValue, newValue) {
            this.field = field;
            this.oldValue = oldValue;
            this.newValue = newValue;
        }
    };
    vm.runInNewContext(signatureSource, context);

    return {
        field: new window.AscPDF.CSignatureField('approval', [10, 20, 110, 60], {}),
        history,
        window
    };
}

function createMemory() {
    return {
        position: 0,
        writes: [],
        WriteByte(value) { this.writes.push(['byte', this.position, value]); this.position += 1; },
        WriteLong(value) { this.writes.push(['long', this.position, value]); this.position += 4; },
        Skip(length) { this.position += length; },
        Seek(position) { this.position = position; },
        GetCurPosition() { return this.position; }
    };
}

test('PDF document exposes active text selection bounds to the mobile touch manager', () => {
    const getSelectionBounds = extractFunction(
        documentSource,
        'CPDFDoc.prototype.GetSelectionBounds = function()'
    );
    const selection = {
        Start: {X: 10, Y: 20, W: 3, H: 4},
        End: {X: 30, Y: 40, W: 5, H: 6}
    };
    const content = {GetSelectionBounds: () => selection};
    const field = {GetDocContent: () => content, GetPage: () => 4};

    assert.deepEqual(JSON.parse(JSON.stringify(getSelectionBounds.call({getTextController: () => field}))), {
        Start: {X: 10, Y: 20, W: 3, H: 4, Page: 4},
        End: {X: 30, Y: 40, W: 5, H: 6, Page: 4}
    });
});

test('PDF form hit testing uses supplied touch coordinates instead of global mouse state', () => {
    const isInForm = extractFunction(
        documentSource,
        'CPDFDoc.prototype.IsInForm = function(x, y, pageIndex)',
        {g_dKoef_pt_to_mm: 0.5}
    );
    const calls = [];
    const field = {};
    const doc = {
        GetPageInfo: () => ({}),
        Viewer: {
            getPageFieldByCoords(x, y, pageIndex) {
                calls.push([x, y, pageIndex]);
                return field;
            }
        }
    };

    assert.equal(isInForm.call(doc, 12, 34, 5), true);
    assert.deepEqual(calls, [[24, 68, 5]]);
});

test('PDF selection API converts real bounds, including a rotated text transform', () => {
    const getSelectionBounds = extractFunction(apiSource, 'PDFEditorApi.prototype.asc_GetSelectionBounds = function()');
    const transform = {
        TransformPointX(x, y) { return x - y; },
        TransformPointY(x, y) { return x + y; }
    };
    const bounds = {
        Start: {X: 10, Y: 20, W: 2, H: 5, Page: 1},
        End: {X: 30, Y: 40, W: 4, H: 6, Page: 2}
    };
    const points = [];
    const api = {
        getPDFDoc() {
            return {
                GetSelectionBounds: () => bounds,
                getTextController: () => ({
                    GetDocContent: () => ({Get_ParentTextTransform: () => transform})
                })
            };
        },
        getDrawingDocument() {
            return {
                ConvertCoordsToCursorWR(x, y, page) {
                    points.push([x, y, page]);
                    return {X: x * 2, Y: y * 2};
                }
            };
        }
    };

    assert.deepEqual(JSON.parse(JSON.stringify(getSelectionBounds.call(api))), [
        [-20, 60],
        [-30, 70],
        [-12, 148],
        [-24, 160]
    ]);
    assert.deepEqual(points, [
        [-10, 30, 1],
        [-15, 35, 1],
        [-6, 74, 2],
        [-12, 80, 2]
    ]);
});

test('PDF form insertion points stay inside the visible page for every rotation', () => {
    const rotations = new Map([
        [0, {x: 90, y: 100}],
        [90, {x: 40, y: 145}],
        [180, {x: 90, y: 190}],
        [270, {x: 140, y: 145}],
    ]);
    let rotation = 0;
    const doc = {
        Viewer: {
            getViewingRect: () => ({x: 0.1, r: 0.9, y: 0.2, b: 0.8}),
            getPageRotate: () => rotation,
        },
        GetPageWidth: () => 200,
        GetPageHeight: () => 300,
    };
    const computeFieldAddingPos = extractFunction(
        documentSource,
        'CPDFDoc.prototype.private_computeFieldAddingPos = function(nPage, nExtX, nExtY)',
        {Asc: {editor: {getPDFDoc: () => doc}}}
    );

    for (const [pageRotation, expected] of rotations) {
        rotation = pageRotation;
        const actual = computeFieldAddingPos.call(doc, 0, 20, 10);
        assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${pageRotation} degree page x`);
        assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${pageRotation} degree page y`);
    }
});

test('signature values synchronize across widgets and preserve filled state', () => {
    const {field, history} = createSignatureField();
    const sibling = createSignatureField().field;
    const doc = {
        GetAllWidgets: () => [field, sibling]
    };
    field.doc = doc;
    sibling.doc = doc;

    field.SetValue(true);
    field.Commit();

    assert.equal(field.GetValue(), 'Signed');
    assert.equal(sibling.GetValue(), 'Signed');
    assert.equal(field.GetParentValue(), 'Signed');
    assert.equal(field.IsFilled(), true);
    assert.equal(field.needCommit, false);
    assert.equal(history.length, 1);
});

test('signature synchronization preserves the parsed Sig state when no parent value exists', () => {
    const {field} = createSignatureField();

    field.SetFilled(true);
    field.parentValue = undefined;
    field.SyncValue();
    assert.equal(field.IsFilled(), true);

    field.parentValue = '';
    field.SyncValue();
    assert.equal(field.IsFilled(), false);
});

test('signature binary flags encode the filled state without a synthetic value string', () => {
    const {field} = createSignatureField();
    const memory = createMemory();

    field.SetFilled(true);
    field.WriteToBinary(memory);

    const fieldFlagsWrite = memory.writes.find(([, position]) => position === memory.posForFieldDataFlags);
    assert.deepEqual(fieldFlagsWrite, ['long', memory.posForFieldDataFlags, 1 << 9]);
    assert.equal(memory.writes.some(([kind]) => kind === 'string'), false);
});

test('signature snapshots expose existing filled fields without duplicates', () => {
    const getAllSignatures = extractFunction(documentSource, 'CPDFDoc.prototype.GetAllSignatures = function()');
    const first = {
        GetType: () => 33,
        GetFullName: () => 'approval',
        GetSignatureInfo: () => ({id: 'approval', filled: true})
    };
    const duplicate = {
        GetType: () => 33,
        GetFullName: () => 'approval',
        GetSignatureInfo: () => ({id: 'approval', filled: true})
    };
    const other = {GetType: () => 27};
    const context = {AscPDF: {FIELD_TYPES: {signature: 33}}};
    const boundFunction = vm.runInNewContext(`(${getAllSignatures.toString()})`, context);

    assert.deepEqual(JSON.parse(JSON.stringify(boundFunction.call({widgets: [first, duplicate, other]}))), [
        {id: 'approval', filled: true}
    ]);
});

test('PDF request signatures exclude filled form fields and preserve pending fields', () => {
    const asc_CSignatureLine = function() {
        this.guid = '';
        this.signer1 = '';
        this.signer2 = '';
        this.email = '';
        this.showDate = false;
        this.instructions = '';
        this.isForm = false;
    };
    const getRequestSignatures = extractFunction(
        apiSource,
        'PDFEditorApi.prototype.asc_getRequestSignatures = function()',
        {AscCommon: {asc_CSignatureLine}}
    );
    const pending = {id: 'pending', signer: 'Alice', signer2: '', email: '', showDate: false, instructions: '', isForm: true, filled: false};
    const filled = {id: 'filled', signer: 'Bob', signer2: '', email: '', showDate: false, instructions: '', isForm: true, filled: true};
    const result = getRequestSignatures.call({
        asc_getAllSignatures: () => [pending, filled],
        signatures: []
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].guid, 'pending');
    assert.equal(result[0].signer1, 'Alice');
});
