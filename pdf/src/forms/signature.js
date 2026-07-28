/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

"use strict";

(function(){
	const SIGNED_VALUE = "Signed";

	function isFilledValue(value) {
		if (value && typeof value === "object" && value.filled != null) {
			return !!value.filled;
		}
		if (typeof value === "string") {
			let normalized = value.toLowerCase();
			return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "off" && normalized !== "unsigned";
		}
		return value === true || value === 1;
	}
	function normalizeSignatureAppearance(value) {
		if (!value || typeof value !== "object") {
			return null;
		}

		let sMode = value["mode"];
		if (sMode !== "typed" && sMode !== "drawn" && sMode !== "image") {
			return null;
		}

		let normalizeText = function(text, limit) {
			return typeof text === "string" ? text.slice(0, limit) : "";
		};
		let oAppearance = {
			mode: sMode,
			signedAt: normalizeText(value["signedAt"], 64)
		};

		if (sMode === "typed") {
			oAppearance.text = normalizeText(value["text"], 256).trim();
			if (!oAppearance.text) {
				return null;
			}

			let sFontFamily = value["fontFamily"];
			oAppearance.fontFamily = ["cursive", "serif", "sans-serif"].includes(sFontFamily) ? sFontFamily : "cursive";
			let sColor = normalizeText(value["color"], 16);
			oAppearance.color = /^#[0-9a-f]{6}$/i.test(sColor) ? sColor.toLowerCase() : "#202327";
		}
		else {
			let sImage = normalizeText(value["image"] || value["dataUrl"], 2 * 1024 * 1024);
			if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(sImage)) {
				return null;
			}
			oAppearance.image = sImage;
		}

		return oAppearance;
	}

    /**
	 * Class representing a signature field.
	 * @constructor
     * @extends {CBaseField}
	 */
    function CSignatureField(sName, aRect, oDoc)
    {
        AscPDF.CBaseField.call(this, sName, AscPDF.FIELD_TYPES.signature, aRect, oDoc);
        this._filled = false;
    };

    CSignatureField.prototype.constructor = CSignatureField;
    AscFormat.InitClass(CSignatureField, AscPDF.CBaseField, AscDFH.historyitem_type_Pdf_Signature_Field);
    
	CSignatureField.prototype.SetValue = function(value) {
		let sValue = isFilledValue(value) ? SIGNED_VALUE : "";
		if (sValue === this.GetValue()) {
			return true;
		}

		AscCommon.History.Add(new CChangesPDFFormValue(this, this.GetValue(), sValue));
		this.private_SetValue(sValue);
		this.SetWasChanged(true);
		this.SetNeedCommit(true);
		this.AddToRedraw();
		return true;
    };
    CSignatureField.prototype.private_SetValue = function(value) {
		this.SetFilled(isFilledValue(value));
	};
	CSignatureField.prototype.GetValue = function() {
		return this.IsFilled() ? SIGNED_VALUE : "";
	};
	CSignatureField.prototype.GetAppearance = function() {
		let oMeta = this.GetMeta() || {};
		let oAppearance = oMeta["signatureAppearance"];
		return oAppearance ? Object.assign({}, oAppearance) : null;
	};
	CSignatureField.prototype.SetAppearance = function(value) {
		let oAppearance = normalizeSignatureAppearance(value);
		if (!oAppearance) {
			return false;
		}

		this.SetValue(true);
		this.Commit();

		let oDoc = this.GetDocument();
		let aFields = oDoc && oDoc.GetAllWidgets ? oDoc.GetAllWidgets(this.GetFullName()) : [this];
		for (let nIndex = 0; nIndex < aFields.length; nIndex++) {
			let oField = aFields[nIndex];
			let oMeta = Object.assign({}, oField.GetMeta() || {});
			oMeta["signatureAppearance"] = Object.assign({}, oAppearance);
			oField.SetMeta(oMeta);
			oField.SetWasChanged(true);
			oField.SetNeedRecalc(true);
			oField.AddToRedraw();
		}

		return true;
	};
    CSignatureField.prototype.Draw = function(oGraphicsPDF, oGraphicsWord) {
		if (this.IsHidden() && !Asc.editor.IsEditFieldsMode()) {
			return;
		}

		if (this.IsNeedDrawFromStream()) {
			this.DrawFromStream(oGraphicsPDF, oGraphicsWord);
			return;
		}

		this.DrawBackground(oGraphicsPDF);
		this.DrawBorders(oGraphicsPDF);
		this.DrawAppearance(oGraphicsPDF);
		this.DrawLocks(oGraphicsPDF);
		this.DrawEdit(oGraphicsWord);
    };
	CSignatureField.prototype.DrawAppearance = function(oGraphicsPDF) {
		let oAppearance = this.GetAppearance();
		if (!oAppearance || !oGraphicsPDF || !window.document) {
			return;
		}

		let aRect = this.GetRect();
		let nWidth = Math.max(aRect[2] - aRect[0], 1);
		let nHeight = Math.max(aRect[3] - aRect[1], 1);
		let oTransform = oGraphicsPDF.GetTransform ? oGraphicsPDF.GetTransform() : null;
		let nScale = Math.max(Math.abs(oTransform && oTransform.sy || 1), 1);
		let oCanvas = window.document.createElement("canvas");
		oCanvas.width = Math.min(Math.max(Math.round(nWidth * nScale), 1), 4096);
		oCanvas.height = Math.min(Math.max(Math.round(nHeight * nScale), 1), 4096);
		let oContext = oCanvas.getContext("2d");
		if (!oContext) {
			return;
		}
		oContext.clearRect(0, 0, oCanvas.width, oCanvas.height);

		if (oAppearance.mode === "typed") {
			oContext.fillStyle = oAppearance.color;
			oContext.textAlign = "center";
			oContext.textBaseline = "middle";
			oContext.font = Math.max(Math.floor(oCanvas.height * 0.55), 12) + "px " + oAppearance.fontFamily;
			oContext.fillText(oAppearance.text, oCanvas.width / 2, oCanvas.height / 2, Math.max(oCanvas.width - 16, 1));
		}
		else {
			let oImage = this._signatureAppearanceImage;
			if (!oImage || oImage._signatureSource !== oAppearance.image) {
				oImage = new window.Image();
				oImage._signatureSource = oAppearance.image;
				oImage.onload = function() {
					this.AddToRedraw();
				}.bind(this);
				oImage.onerror = function() {
					if (this._signatureAppearanceImage === oImage) {
						this._signatureAppearanceImage = null;
					}
				}.bind(this);
				this._signatureAppearanceImage = oImage;
				oImage.src = oAppearance.image;
			}
			if (!oImage.complete || !(oImage.naturalWidth || oImage.width) || !(oImage.naturalHeight || oImage.height)) {
				return;
			}

			let nImageWidth = oImage.naturalWidth || oImage.width;
			let nImageHeight = oImage.naturalHeight || oImage.height;
			let nImageScale = Math.min(oCanvas.width / nImageWidth, oCanvas.height / nImageHeight);
			let nDrawWidth = nImageWidth * nImageScale;
			let nDrawHeight = nImageHeight * nImageScale;
			oContext.drawImage(oImage, (oCanvas.width - nDrawWidth) / 2, (oCanvas.height - nDrawHeight) / 2, nDrawWidth, nDrawHeight);
		}

		oGraphicsPDF.SetIntegerGrid(true);
		oGraphicsPDF.DrawImageXY(oCanvas, aRect[0], aRect[1], undefined, true);
		oGraphicsPDF.SetIntegerGrid(false);
	};
    CSignatureField.prototype.DrawPressed = function() {
		if (this.IsReadOnly()) {
			return;
		}
		this.SetPressed(true);
		this.AddToRedraw();
    };
    CSignatureField.prototype.DrawUnpressed = function() {
		this.SetPressed(false);
		this.AddToRedraw();
    };
    CSignatureField.prototype.Recalculate = function() {
		this.SetNeedRecalc(false);
    };

    CSignatureField.prototype.SetPressed = function(bValue) {
        this._pressed = bValue;
    };
    CSignatureField.prototype.IsPressed = function() {
        return this._pressed;
    };
    CSignatureField.prototype.IsHovered = function() {
        return this._hovered;
    };
    CSignatureField.prototype.SetHovered = function(bValue) {
        this._hovered = bValue;
    };

    CSignatureField.prototype.onMouseDown = function(x, y, e) {
		let oDoc = this.GetDocument();
		let bInFocus = oDoc.activeForm === this;
		oDoc.activeForm = this;

		if (oDoc.IsEditFieldsMode()) {
			let oEditShape = this.GetEditShape();
			oEditShape && oEditShape.onMouseDown(x, y, e);
			return;
		}

		let oDrawingDocument = oDoc.GetDrawingDocument();
		oDrawingDocument && oDrawingDocument.TargetEnd();
		this.SetInForm(true);
		this.DrawPressed();
		if (bInFocus)
			this.AddActionsToQueue(AscPDF.PDF_TRIGGERS_TYPES.MouseDown);
		else
			this.AddActionsToQueue(AscPDF.PDF_TRIGGERS_TYPES.MouseDown, AscPDF.PDF_TRIGGERS_TYPES.OnFocus);
    };
    CSignatureField.prototype.onMouseUp = function() {
		if (this.IsReadOnly()) {
			return;
		}

		let oDoc = this.GetDocument();
		this.DrawUnpressed();
		this.AddActionsToQueue(AscPDF.PDF_TRIGGERS_TYPES.MouseUp);

		let oApi = oDoc.Api || Asc.editor;
		if (oApi && oApi.sendEvent) {
			let aRect = this.GetRect();
			oApi.sendEvent("asc_onSignatureFieldClick", this.GetSignatureInfo(), aRect[2] - aRect[0], aRect[3] - aRect[1]);
		}
    };

    CSignatureField.prototype.SetFilled = function(bValue) {
		bValue = !!bValue;
		if (this._filled === bValue) {
			return;
		}

		this._filled = bValue;
		this.SetDrawHighlight(!bValue);
		this.SetNeedRecalc(true);
    };
    CSignatureField.prototype.IsFilled = function() {
        return this._filled;
    };
    CSignatureField.prototype.SetDrawHighlight = function(bDraw) {
        if (this.IsFilled()) {
            this._needDrawHighlight = false;
        }
        else {
            this._needDrawHighlight = bDraw;
        }
    };
    /**
     * Synchronizes this field with fields with the same name.
     * @memberof CSignatureField
     * @typeofeditors ["PDF"]
     */
    CSignatureField.prototype.SyncValue = function() {
		let value = this.GetParentValue();
		if (value !== undefined) {
			this.SetFilled(isFilledValue(value));
		}
		this.SetNeedCommit(false);
    };
    /**
     * Applies value of this field to all field with the same name.
     * @memberof CSignatureField
     * @typeofeditors ["PDF"]
     */
    CSignatureField.prototype.Commit = function() {
		let oDoc = this.GetDocument();
		let bFilled = this.IsFilled();
		let sValue = bFilled ? SIGNED_VALUE : "";
		let aFields = oDoc.GetAllWidgets(this.GetFullName());

		this.SetParentValue(sValue);
		for (let nIndex = 0; nIndex < aFields.length; nIndex++) {
			aFields[nIndex].SetFilled(bFilled);
			aFields[nIndex].SetWasChanged(true);
			aFields[nIndex].SetNeedCommit(false);
		}
    };

    CSignatureField.prototype.Reset = function() {
		let bFilled = isFilledValue(this.GetDefaultValue());
		if (bFilled === this.IsFilled()) {
			return;
		}

		this.SetValue(bFilled);
		this.Commit();
    };
	CSignatureField.prototype.GetSignatureInfo = function() {
		let oMeta = this.GetMeta() || {};
		let oInfo = AscFormat.CSignatureLine ? new AscFormat.CSignatureLine() : {};
		let sId = oMeta.signatureId || oMeta.guid || this.GetFullName() || String(this.GetApIdx());

		oInfo.id = sId;
		oInfo.signer = oMeta.signer || oMeta.signer1 || "";
		oInfo.signer2 = oMeta.signer2 || "";
		oInfo.email = oMeta.email || "";
		oInfo.showDate = !!oMeta.showDate;
		oInfo.instructions = oMeta.instructions || "";
		oInfo.filled = this.IsFilled();
		oInfo.page = this.GetPage();
		oInfo.rect = this.GetRect().slice();
		oInfo.isForm = true;
		oInfo.appearance = this.GetAppearance();
		return oInfo;
	};
	
    CSignatureField.prototype.WriteToBinary = function(memory) {
		memory.WriteByte(AscCommon.CommandType.ctAnnotField);

		let nStartPos = memory.GetCurPosition();
		memory.Skip(4);

		this.WriteToBinaryBase(memory);
		this.WriteToBinaryBase2(memory);
		if (this.IsFilled()) {
			memory.fieldDataFlags |= (1 << 9);
		}

		let nEndPos = memory.GetCurPosition();
		memory.Seek(memory.posForWidgetFlags);
		memory.WriteLong(memory.widgetFlags);
		memory.Seek(memory.posForFieldDataFlags);
		memory.WriteLong(memory.fieldDataFlags);
		memory.Seek(nStartPos);
		memory.WriteLong(nEndPos - nStartPos);
		memory.Seek(nEndPos);

		this.CheckWidgetFlags(memory);
	};
    function MakeColorMoreGray(rgbColor, nPower) {
        // Get color component values
        const r = rgbColor.r;
        const g = rgbColor.g;
        const b = rgbColor.b;
      
        // Calculate new component values with darkening (reducing intensity)
        const grayR = Math.max(0, r - nPower);
        const grayG = Math.max(0, g - nPower);
        const grayB = Math.max(0, b - nPower);
      
        // Return new gray color
        return {
            r: grayR,
            g: grayG,
            b: grayB
        };
    }

    window["AscPDF"].CSignatureField = CSignatureField;
	window["AscPDF"].CSignatureField.prototype["asc_GetValue"] = CSignatureField.prototype.GetValue;
	window["AscPDF"].CSignatureField.prototype["asc_IsFilled"] = CSignatureField.prototype.IsFilled;
	window["AscPDF"].CSignatureField.prototype["asc_GetAppearance"] = CSignatureField.prototype.GetAppearance;
})();

