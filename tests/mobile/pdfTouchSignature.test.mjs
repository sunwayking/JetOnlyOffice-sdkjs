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
const fileSource = readFileSync(new URL('../../pdf/src/file.js', import.meta.url), 'utf8');
const signatureSource = readFileSync(new URL('../../pdf/src/forms/signature.js', import.meta.url), 'utf8');
const baseFieldSource = readFileSync(new URL('../../pdf/src/forms/base/base.js', import.meta.url), 'utf8');
const metafileSource = readFileSync(new URL('../../common/Drawings/Metafile.js', import.meta.url), 'utf8');

function loadPdfDocumentPrototype({editor = {}, ptToMm = 0.5} = {}) {
    function BaseNoIdObject() {}
    const window = {
        AscPDF: {
            FIELD_TYPES: {
                text: 0,
                button: 1,
                checkbox: 2,
                radiobutton: 3,
                combobox: 4,
                listbox: 5,
                signature: 33,
            },
            BORDER_TYPES: {solid: 0},
        },
        AscCommon: {},
        AscFormat: {CBaseNoIdObject: BaseNoIdObject},
        AscWord: {},
        Asc: {editor},
        AscDFH: {},
        AscCommonWord: {},
    };
    window.window = window;
    vm.runInNewContext(documentSource, {
        window,
        console,
        CPresentation: function() {},
        g_dKoef_pt_to_mm: ptToMm,
        ...window,
    });
    return window.AscPDF.CPDFDoc.prototype;
}

function loadPdfApiPrototype({signatureLineCtor = function() {}, history = {}} = {}) {
    function DocumentEditorApi() {}
    DocumentEditorApi.prototype = {};
    const window = {
        AscCommon: {DocumentEditorApi, c_oEditorId: {Word: 1}, asc_CSignatureLine: signatureLineCtor},
        Asc: {},
        AscPDF: {FIELD_TYPES: {signature: 33}},
        AscDFH: history,
        AscFormat: {},
        AscCommonWord: {},
        AscWord: {},
        AscFonts: {},
    };
    window.window = window;
    vm.runInNewContext(apiSource, {
        window,
        document: {},
        performance: {now: () => 0},
        console,
        prot: null,
        ...window,
    });
    return window.PDFEditorApi.prototype;
}

function createPdfFile() {
    const pdfDoc = {activeDrawing: null, pagesTransform: []};
    const window = {
        AscCommon: {
            AscBrowser: {isIE: false, isIeEdge: false, isAppleDevices: false, isAndroid: true},
        },
        AscViewer: {},
        AscPDF: {},
        Asc: {editor: {getPDFDoc: () => pdfDoc}},
    };
    window.window = window;
    vm.runInNewContext(fileSource, {
        window,
        document: {},
        performance: {now: () => 0},
        console,
        g_dKoef_mm_to_pt: 72 / 25.4,
        ...window,
    });
    return {file: window.AscViewer.createEmptyFile(), pdfDoc};
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
        SetMeta(value) {
            history.push({field: this, oldMeta: this.meta, newMeta: value});
            this.meta = value;
        },
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
        window,
        context,
    };
}

function createBinaryMemory() {
    function GraphicsBase() {}
    function FontManager() {}
    FontManager.prototype.Initialize = function() {};
    FontManager.prototype.SetHintsProps = function() {};
    const window = {
        AscCommon: {CGraphicsBase: GraphicsBase},
        AscFonts: {CFontManager: FontManager},
        AscFormat: {},
    };
    window.window = window;
    vm.runInNewContext(metafileSource, {window, document: {}, console, ImageData: function() {}, ...window});
    return new window.AscCommon.CMemory();
}

function createSerializableSignatureField() {
    function BaseNoIdObject() {}
    function GraphicObjectBase() {}
    GraphicObjectBase.prototype.select = function() {};
    const history = [];
    const triggerTypes = {
        MouseUp: 0,
        MouseDown: 1,
        MouseEnter: 2,
        MouseExit: 3,
        OnFocus: 4,
        OnBlur: 5,
        Keystroke: 6,
        Validate: 7,
        Calculate: 8,
        Format: 9,
    };
    const window = {
        AscPDF: {
            Api: {Types: {display: {visible: 0}}},
            CPdfTriggers: function() {},
            FIELD_TYPES: {
                text: 0,
                button: 1,
                checkbox: 2,
                radiobutton: 3,
                combobox: 4,
                listbox: 5,
                signature: 33,
            },
            PDF_TRIGGERS_TYPES: triggerTypes,
            APPEARANCE_TYPES: {normal: 0},
        },
        AscCommon: {
            g_oIdCounter: {Get_NewId: () => 1, m_bLoad: false},
            History: {CanAddChanges: () => false, Add: change => history.push(change)},
            g_oTableId: {Add() {}},
            CLock: function() {},
            CContentChanges: function() {},
            CMatrix: function() {},
            CommandType: {ctAnnotField: 164},
        },
        AscFormat: {
            CBaseNoIdObject: BaseNoIdObject,
            CGraphicObjectBase: GraphicObjectBase,
            InitClass(child, parent) {
                child.prototype = Object.create(parent.prototype);
                child.prototype.constructor = child;
            },
            CSignatureLine: function() {},
        },
        Asc: {editor: {}},
        AscDFH: {historyitem_type_Pdf_Signature_Field: 1},
    };
    window.window = window;
    const context = {
        window,
        console,
        ...window,
        CChangesPDFFormValue: function(field, oldValue, newValue) {
            this.field = field;
            this.oldValue = oldValue;
            this.newValue = newValue;
        },
    };
    vm.runInNewContext(baseFieldSource, context);
    vm.runInNewContext(signatureSource, context);

    const field = new window.AscPDF.CSignatureField();
    field.type = window.AscPDF.FIELD_TYPES.signature;
    field._partialName = 'approval';
    field._apIdx = 7;
    field._origPage = 2;
    field._rect = [10, 20, 110, 60];
    field._meta = {
        signer: 'Alice',
        signatureAppearance: {
            mode: 'typed',
            text: 'Alice Example',
            fontFamily: 'serif',
            color: '#125e4f',
            signedAt: '2026-07-28T12:00:00.000Z',
        },
    };
    field._filled = true;
    return field;
}

test('PDF document exposes active text selection bounds to the mobile touch manager', () => {
    const documentPrototype = loadPdfDocumentPrototype();
    const document = Object.create(documentPrototype);
    const selection = {
        Start: {X: 10, Y: 20, W: 3, H: 4},
        End: {X: 30, Y: 40, W: 5, H: 6}
    };
    const content = {GetSelectionBounds: () => selection};
    const field = {GetDocContent: () => content, GetPage: () => 4};
    document.getTextController = () => field;

    assert.deepEqual(JSON.parse(JSON.stringify(document.GetSelectionBounds())), {
        Start: {X: 10, Y: 20, W: 3, H: 4, Page: 4},
        End: {X: 30, Y: 40, W: 5, H: 6, Page: 4}
    });
});

test('PDF page text selection exposes transformed multi-page bounds through the real CFile prototype', () => {
    const {file, pdfDoc} = createPdfFile();
    file.isSelectionUse = () => true;
    file.getSelectionQuads = () => [
        {page: 0, quads: [[1, 2, 5, 2, 1, 4, 5, 4], [0, 5, 6, 5, 0, 7, 6, 7]]},
        {page: 1, quads: [[10, 20, 14, 20, 10, 23, 14, 23]]},
    ];
    pdfDoc.pagesTransform = [
        {invert: {TransformPoint: (x, y) => ({x: x + 100, y: y + 200})}},
        {invert: {TransformPoint: (x, y) => ({x: 50 - y, y: x + 10})}},
    ];
    file.viewer = {getPDFDoc: () => pdfDoc};

    assert.deepEqual(JSON.parse(JSON.stringify(file.getSelectionBounds())), {
        Start: {X: 100, Y: 202, W: 6, H: 5, Page: 0},
        End: {X: 27, Y: 20, W: 3, H: 4, Page: 1},
    });

    const document = Object.create(loadPdfDocumentPrototype());
    document.Viewer = {file};
    document.getTextController = () => null;
    assert.deepEqual(JSON.parse(JSON.stringify(document.GetSelectionBounds())), {
        Start: {X: 100, Y: 202, W: 6, H: 5, Page: 0},
        End: {X: 27, Y: 20, W: 3, H: 4, Page: 1},
    });
});

test('PDF form hit testing uses supplied touch coordinates instead of global mouse state', () => {
    const document = Object.create(loadPdfDocumentPrototype());
    const calls = [];
    const field = {};
    document.GetPageInfo = () => ({});
    document.Viewer = {
        getPageFieldByCoords(x, y, pageIndex) {
            calls.push([x, y, pageIndex]);
            return field;
        }
    };

    assert.equal(document.IsInForm(12, 34, 5), true);
    assert.deepEqual(calls, [[24, 68, 5]]);
});

test('PDF selection API converts real bounds, including a rotated text transform', () => {
    const api = Object.create(loadPdfApiPrototype());
    const transform = {
        TransformPointX(x, y) { return x - y; },
        TransformPointY(x, y) { return x + y; }
    };
    const bounds = {
        Start: {X: 10, Y: 20, W: 2, H: 5, Page: 1},
        End: {X: 30, Y: 40, W: 4, H: 6, Page: 2}
    };
    const points = [];
    Object.assign(api, {
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
        },
    });

    assert.deepEqual(JSON.parse(JSON.stringify(api.asc_GetSelectionBounds())), [
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
    const documentPrototype = loadPdfDocumentPrototype({editor: {getPDFDoc: () => doc}});

    for (const [pageRotation, expected] of rotations) {
        rotation = pageRotation;
        const actual = documentPrototype.private_computeFieldAddingPos.call(doc, 0, 20, 10);
        assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${pageRotation} degree page x`);
        assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${pageRotation} degree page y`);
    }
});

test('PDF document and API create a real signature field through exported prototypes', () => {
    const document = Object.create(loadPdfDocumentPrototype());
    const createdField = {
        SetMeta(value) { this.meta = value; },
        SetBorderColor(value) { this.borderColor = value; },
        SetBorderStyle(value) { this.borderStyle = value; },
        SetBorderWidth(value) { this.borderWidth = value; },
    };
    const createCalls = [];
    document.CreateNewFieldName = type => {
        assert.equal(type, 33);
        return 'Signature1';
    };
    document.CreateField = (name, type, rect) => {
        createCalls.push([name, type, rect]);
        return createdField;
    };

    assert.equal(document.CreateSignatureField({
        signer: 'Alice',
        email: 'alice@example.test',
        instructions: 'Approve',
        showDate: true,
    }), createdField);
    assert.deepEqual(JSON.parse(JSON.stringify(createCalls)), [['Signature1', 33, [10, 10, 130, 46]]]);
    assert.deepEqual(JSON.parse(JSON.stringify(createdField.meta)), {
        signer: 'Alice',
        signer2: '',
        email: 'alice@example.test',
        instructions: 'Approve',
        showDate: true,
        signatureId: 'Signature1',
    });

    const history = {historydescription_Pdf_AddField: 7};
    const api = Object.create(loadPdfApiPrototype({history}));
    const addCalls = [];
    const apiDocument = {
        DoAction(action, description, owner) {
            assert.equal(description, 7);
            assert.equal(owner, api);
            return action();
        },
        CreateSignatureField(params) {
            addCalls.push(['create', params]);
            return createdField;
        },
        AddField(field, page, fromUi) {
            addCalls.push(['add', field, page, fromUi]);
        },
        GetCurPage: () => 4,
    };
    api.getPDFDoc = () => apiDocument;

    assert.equal(api.AddSignatureField({signer: 'Alice'}), true);
    assert.deepEqual(addCalls, [
        ['create', {signer: 'Alice'}],
        ['add', createdField, 4, true],
    ]);
});

test('PDF clear-all API resets every form in one real document action', () => {
    const history = {historydescription_Document_ClearAllSpecialForms: 0x182};
    const api = Object.create(loadPdfApiPrototype({history}));
    const calls = [];
    const document = {
        DoAction(action, description, owner) {
            calls.push(['action', description, owner]);
            return action();
        },
        ResetForms(names, allExcept) {
            calls.push(['reset', names, allExcept]);
        },
        GetAllSignatures: () => [],
    };
    api.getPDFDoc = () => document;
    api.sendEvent = (...args) => calls.push(['event', ...args]);

    assert.equal(api.asc_ClearAllSpecialForms(), true);
    assert.equal(calls[0][1], 0x182);
    assert.equal(calls[0][2], api);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), ['reset', [], false]);
    assert.deepEqual(calls[2], ['event', 'asc_onUpdateSignatureFields', []]);
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

test('signature binary serialization writes appearance metadata through the real writer memory', () => {
    const field = createSerializableSignatureField();
    const memory = createBinaryMemory();
    field.WriteToBinary(memory);

    const data = Buffer.from(memory.GetDataUint8());
    const expectedJson = JSON.stringify(field.GetMeta());
    const encodedJson = Buffer.from(expectedJson, 'utf16le');
    const metadataOffset = data.indexOf(encodedJson);
    assert.ok(metadataOffset >= 2, 'signature metadata must be present in the annotation-field payload');
    assert.equal(data.readUInt16LE(metadataOffset - 2), expectedJson.length);
    assert.deepEqual(JSON.parse(data.subarray(metadataOffset, metadataOffset + encodedJson.length).toString('utf16le')), field.GetMeta());

    const fieldFlags = data.readInt32LE(memory.posForFieldDataFlags);
    assert.equal(fieldFlags & (1 << 9), 1 << 9);
});

test('signature snapshots expose existing filled fields without duplicates', () => {
    const document = Object.create(loadPdfDocumentPrototype());
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
    Object.defineProperty(document, 'widgets', {value: [first, duplicate, other]});
    assert.deepEqual(JSON.parse(JSON.stringify(document.GetAllSignatures())), [
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
    const apiPrototype = loadPdfApiPrototype({signatureLineCtor: asc_CSignatureLine});
    const api = Object.create(apiPrototype);
    const pending = {id: 'pending', signer: 'Alice', signer2: '', email: '', showDate: false, instructions: '', isForm: true, filled: false};
    const filled = {id: 'filled', signer: 'Bob', signer2: '', email: '', showDate: false, instructions: '', isForm: true, filled: true};
    api.asc_getSignatureFields = () => [pending, filled];
    api.signatures = [];
    const result = api.asc_getRequestSignatures();
    assert.equal(result.length, 1);
    assert.equal(result[0].guid, 'pending');
    assert.equal(result[0].signer1, 'Alice');
});

test('PDF signature appearance API fails closed without a core persistence capability', () => {
    const api = Object.create(loadPdfApiPrototype());
    let fieldLookupCount = 0;
    api.getPDFDoc = () => ({
        IsSignatureAppearancePersistenceSupported: () => false,
        GetField() {
            fieldLookupCount += 1;
            return null;
        },
    });

    assert.equal(api.asc_SetSignatureFieldAppearance({fieldId: 'approval', mode: 'typed', text: 'Alice'}), false);
    assert.equal(fieldLookupCount, 0);
});

test('PDF signature appearance API separates form-field and certificate signature updates', () => {
    const history = {historydescription_Pdf_FieldCommit: 9};
    const api = Object.create(loadPdfApiPrototype({history}));
    const events = [];
    const appearance = {fieldId: 'approval', mode: 'typed', text: 'Alice'};
    const field = {
        GetType: () => 33,
        SetAppearance(value) {
            assert.equal(value, appearance);
            return true;
        },
    };
    const document = {
        IsSignatureAppearancePersistenceSupported: () => true,
        GetField: id => id === 'approval' ? field : null,
        DoAction(action, description, owner) {
            assert.equal(description, 9);
            assert.equal(owner, api);
            return action();
        },
        GetAllSignatures: () => [{id: 'approval', filled: true}],
    };
    const certificateSignatures = [{id: 'certificate-signature'}];
    api.getPDFDoc = () => document;
    api.asc_getSignatures = () => certificateSignatures;
    api.asc_getRequestSignatures = () => [];
    api.sendEvent = (...args) => events.push(args);

    assert.equal(api.asc_SetSignatureFieldAppearance(appearance), true);
    assert.deepEqual(JSON.parse(JSON.stringify(events)), [
        ['asc_onUpdateSignatureFields', [{id: 'approval', filled: true}]],
        ['asc_onUpdateSignatures', certificateSignatures, []],
    ]);
});

test('signature appearance is validated, synchronized, and exposed in signature snapshots', () => {
    const {field} = createSignatureField();
    const sibling = createSignatureField().field;
    const doc = {GetAllWidgets: () => [field, sibling]};
    field.doc = doc;
    sibling.doc = doc;

    assert.equal(field.SetAppearance({
        id: 'approval',
        mode: 'typed',
        text: 'Alice Example',
        fontFamily: 'serif',
        color: '#125e4f',
        signedAt: '2026-07-28T12:00:00.000Z',
    }), true);

    const expected = {
        mode: 'typed',
        text: 'Alice Example',
        fontFamily: 'serif',
        color: '#125e4f',
        signedAt: '2026-07-28T12:00:00.000Z',
    };
    assert.deepEqual(JSON.parse(JSON.stringify(field.GetAppearance())), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(sibling.GetAppearance())), expected);
    assert.equal(field.IsFilled(), true);
    assert.equal(sibling.IsFilled(), true);
    assert.deepEqual(JSON.parse(JSON.stringify(field.GetSignatureInfo().appearance)), expected);

    assert.equal(field.SetAppearance({mode: 'image', image: 'https://example.test/signature.png'}), false);
    assert.deepEqual(JSON.parse(JSON.stringify(field.GetAppearance())), expected);
});

test('typed signature appearance renders into the PDF field rectangle', () => {
    const {field, window} = createSignatureField();
    const canvasContext = {
        clearRectCalls: [],
        fillTextCalls: [],
        clearRect(...args) { this.clearRectCalls.push(args); },
        fillText(...args) { this.fillTextCalls.push(args); },
    };
    const canvas = {width: 0, height: 0, getContext: () => canvasContext};
    window.document = {createElement: type => {
        assert.equal(type, 'canvas');
        return canvas;
    }};
    field.meta = {
        signatureAppearance: {
            mode: 'typed',
            text: 'Alice Example',
            fontFamily: 'serif',
            color: '#125e4f',
            signedAt: '',
        },
    };
    const graphicsCalls = [];
    const graphics = {
        GetTransform: () => ({sy: 2}),
        SetIntegerGrid: value => graphicsCalls.push(['grid', value]),
        DrawImageXY: (...args) => graphicsCalls.push(['image', ...args]),
    };

    field.DrawAppearance(graphics);

    assert.equal(canvas.width, 200);
    assert.equal(canvas.height, 80);
    assert.equal(canvasContext.fillStyle, '#125e4f');
    assert.equal(canvasContext.textAlign, 'center');
    assert.equal(canvasContext.textBaseline, 'middle');
    assert.match(canvasContext.font, /^44px serif$/);
    assert.deepEqual(canvasContext.fillTextCalls, [['Alice Example', 100, 40, 184]]);
    assert.deepEqual(graphicsCalls, [
        ['grid', true],
        ['image', canvas, 10, 20, undefined, true],
        ['grid', false],
    ]);
});

test('drawn signature appearance renders a bounded data image and schedules repaint', () => {
    const {field, window} = createSignatureField();
    const drawImageCalls = [];
    const canvasContext = {
        clearRect() {},
        drawImage: (...args) => drawImageCalls.push(args),
    };
    const canvas = {width: 0, height: 0, getContext: () => canvasContext};
    window.document = {createElement: () => canvas};
    window.Image = class {
        set src(value) {
            this._src = value;
            this.complete = true;
            this.naturalWidth = 200;
            this.naturalHeight = 100;
            this.onload();
        }
        get src() { return this._src; }
    };
    field.meta = {
        signatureAppearance: {
            mode: 'drawn',
            image: 'data:image/png;base64,AAAA',
            signedAt: '',
        },
    };
    const graphics = {
        GetTransform: () => ({sy: 1}),
        SetIntegerGrid() {},
        DrawImageXY() {},
    };

    field.DrawAppearance(graphics);

    assert.equal(field.redraws, 1);
    assert.equal(drawImageCalls.length, 1);
    assert.deepEqual(drawImageCalls[0].slice(1), [10, 0, 80, 40]);
});
