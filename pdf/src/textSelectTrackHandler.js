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

(function(window) {
	/**
	 * This class controls text select track events. You can call update events on this class
	 * as many times as needed, and this class will only send events to the renderer and interface
	 * when something actually changes
	 *
	 * @constructor
	 */
	function CTextSelectTrackHandler(drawingDocument, eventHandler) {
		this.DrawingDocument = drawingDocument;
		this.EventHandler    = eventHandler;
	}

	CTextSelectTrackHandler.prototype.Update = function(bCheckMouseUpPos) {
		this.OnChangePosition(bCheckMouseUpPos);
	};
	CTextSelectTrackHandler.prototype.OnChangePosition = function(bCheckMouseUpPos) {
		let oDoc = Asc.editor.getPDFDoc();
		let isCanEditShape = Asc.editor.canEdit();

		let oFile = Asc.editor.getDocumentRenderer().file;
		if (false == oFile.isSelectionUse() || false === Asc.editor.NeedShowTextSelectPanel() || (oDoc.activeDrawing && isCanEditShape)) {
			this.OnHide();
			return;
		}
		
		let bounds = this.GetBounds();
		if (!bounds) {
			this.OnHide();
			return;
		}

		this.OnShow(bounds, bCheckMouseUpPos);
	};

	////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	// Private area
	////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
	CTextSelectTrackHandler.prototype.GetBounds = function() {
		let oViewer		= Asc.editor.getDocumentRenderer();
		let oFile		= oViewer.file;
		let oBounds		= oFile.getSelectionBounds ? oFile.getSelectionBounds() : null;

		if (!oBounds || !oBounds.Start || !oBounds.End) {
			return null;
		}

		let x1 = Math.min(oBounds.Start.X, oBounds.End.X);
		let x2 = Math.max(oBounds.Start.X + oBounds.Start.W, oBounds.End.X + oBounds.End.W);
		let y1 = Math.min(oBounds.Start.Y, oBounds.End.Y);
		let y2 = Math.max(oBounds.Start.Y + oBounds.Start.H, oBounds.End.Y + oBounds.End.H);

		return [x1, y1, x2, y2];
	};
	CTextSelectTrackHandler.prototype.OnHide = function() {
		this.EventHandler.sendEvent("asc_onHideTextSelectTrack");
	};
	CTextSelectTrackHandler.prototype.OnShow = function(bounds, bCheckMouseUpPos) {
		let isMouseUpOnTop;

		if (bCheckMouseUpPos) {
			let oViewer = Asc.editor.getDocumentRenderer();
			let nRectH = bounds[3] - bounds[1];
			
			if (AscCommon.global_mouseEvent.Y - oViewer.y < bounds[1] + nRectH / 2) {
				isMouseUpOnTop = true;
			}
			else {
				isMouseUpOnTop = false;
			}
		}

		this.EventHandler.sendEvent("asc_onShowTextSelectTrack", bounds, isMouseUpOnTop);
	};
	
	//--------------------------------------------------------export----------------------------------------------------
	window['AscPDF'] = window['AscPDF'] || {};
	window['AscPDF'].CTextSelectTrackHandler = CTextSelectTrackHandler;
})(window);
