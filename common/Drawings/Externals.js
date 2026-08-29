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

(function(window, document){

    // Import
    var FontStyle = AscFonts.FontStyle;

    // global maps for fast lookup
    var g_map_font_index = {};
    var g_fonts_streams = [];

    var isLoadFontsSync = (window["NATIVE_EDITOR_ENJINE"] === true);

    function CFontFileLoader(id)
    {
        this.LoadingCounter = 0;
        this.Id             = id;
        this.Status         = -1;  // -1 - notloaded, 0 - loaded, 1 - error, 2 - loading
        this.stream_index   = -1;
        this.callback       = null;
    }

    CFontFileLoader.prototype.GetMaxLoadingCount = function()
    {
        return 3;
    };
    CFontFileLoader.prototype.CheckLoaded = function()
    {
        return (0 === this.Status || 1 === this.Status);
    };
    CFontFileLoader.prototype.SetStreamIndex = function(index)
    {
        this.stream_index = index;
    };
    CFontFileLoader.prototype.LoadFontFromData = function(data)
    {
        let stream_index = g_fonts_streams.length;
        g_fonts_streams[stream_index] = new AscFonts.FontStream(data, data.length);
        this.SetStreamIndex(stream_index);
        this.Status = 0;
    };
    CFontFileLoader.prototype.LoadFontNative = function()
    {
        let data = window["native"]["GetFontBinary"](this.Id);
        this.LoadFontFromData(data);
    };
    CFontFileLoader.prototype.LoadFontArrayBuffer = function(basePath)
    {
        var xhr = new XMLHttpRequest();
        xhr.fontFile = this;
        xhr.open('GET', basePath + this.Id, true);

        if (typeof ArrayBuffer !== 'undefined' && !window.opera)
            xhr.responseType = 'arraybuffer';

        if (xhr.overrideMimeType)
            xhr.overrideMimeType('text/plain; charset=x-user-defined');
        else
            xhr.setRequestHeader('Accept-Charset', 'x-user-defined');

        xhr.onload = function()
        {
            if (this.status !== 200)
                return this.onerror();

            this.fontFile.Status = 0;
            if (typeof ArrayBuffer !== 'undefined' && !window.opera && this.response)
            {
                this.fontFile.LoadFontFromData(new Uint8Array(this.response));
            }
            else if (AscCommon.AscBrowser.isIE)
            {
                let _response = new VBArray(this["responseBody"]).toArray();

                let srcLen = _response.length;
                let stream = new AscFonts.FontStream(AscFonts.allocate(srcLen), srcLen);

                let dstPx = stream.data;
                let index = 0;

                while (index < srcLen)
                {
                    dstPx[index] = _response[index];
                    index++;
                }

                let stream_index = g_fonts_streams.length;
                g_fonts_streams[stream_index] = stream;
                this.fontFile.SetStreamIndex(stream_index);
            }
            else
            {
                let stream_index = g_fonts_streams.length;
                g_fonts_streams[stream_index] = AscFonts.CreateFontData3(this.responseText);
                this.fontFile.SetStreamIndex(stream_index);
            }

            // decode
            let guidOdttf = [0xA0, 0x66, 0xD6, 0x20, 0x14, 0x96, 0x47, 0xfa, 0x95, 0x69, 0xB8, 0x50, 0xB0, 0x41, 0x49, 0x48];
            let stream = g_fonts_streams[g_fonts_streams.length - 1];
            let data = stream.data;

            let count_decode = Math.min(32, stream.size);
            for (let i = 0; i < count_decode; ++i)
                data[i] ^= guidOdttf[i % 16];

            if (null != this.fontFile.callback)
                this.fontFile.callback();
            if (this.fontFile["externalCallback"])
                this.fontFile["externalCallback"]();
        };
        xhr.onerror = function()
        {
            this.fontFile.LoadingCounter++;
            if (this.fontFile.LoadingCounter < this.fontFile.GetMaxLoadingCount())
            {
                //console.log("font loaded: one more attemption");
                this.fontFile.Status = -1;
                return;
            }

            this.fontFile.Status = 2; // aka loading...
            window["Asc"]["editor"].sendEvent("asc_onError", Asc.c_oAscError.ID.LoadingFontError, Asc.c_oAscError.Level.Critical);
        };

        xhr.send(null);
    };
    CFontFileLoader.prototype.LoadFontAsync = function(basePath, callback)
    {
        if (isLoadFontsSync)
            return true;

        if (window["AscDesktopEditor"] !== undefined)
        {
            if (-1 !== this.Status)
                return true;

            window["AscDesktopEditor"]["LoadFontBase64"](this.Id);

            let streams_count = g_fonts_streams.length;
            g_fonts_streams[streams_count] = AscFonts.CreateFontData4(window[this.Id]);
            this.SetStreamIndex(streams_count);

            this.Status = 0;
            delete window[this.Id];

            if (callback)
                callback();
            if (this["externalCallback"])
                this["externalCallback"]();
            return;
        }

        this.callback = callback;

        if (-1 !== this.Status)
            return true;

        this.Status = 2;
        this.LoadFontArrayBuffer(basePath);
        return false;
    };

    CFontFileLoader.prototype["LoadFontAsync"] = CFontFileLoader.prototype.LoadFontAsync;
    CFontFileLoader.prototype["GetID"] = function() { return this.Id; };
    CFontFileLoader.prototype["GetStatus"] = function() { return this.Status; };
    CFontFileLoader.prototype["GetStreamIndex"] = function() { return this.stream_index; };

    function CFontFileLoaderEmbed(id)
    {
        this.Id             = id;
        this.Status         = -1;  // -1 - notloaded, 0 - loaded, 1 - error, 2 - loading
        this.stream_index   = -1;
        this.callback       = null;
    }

    CFontFileLoaderEmbed.prototype.startIndex = -1;
    CFontFileLoaderEmbed.prototype.CheckLoaded = function()
    {
        return (0 === this.Status || 1 === this.Status);
    };
    CFontFileLoaderEmbed.prototype.SetStreamIndex = function(index)
    {
        this.stream_index = index;
    };
    CFontFileLoaderEmbed.prototype.LoadFontAsync = function()
    {
        if (this.Status === 0 || this.Status === 1)
            return true;

        let fontData = AscFonts.loadEmbeddedFont(this.Id);
        if (fontData)
        {
            let stream_index = g_fonts_streams.length;
            g_fonts_streams[stream_index] = new AscFonts.FontStream(fontData, fontData.length);
            this.SetStreamIndex(stream_index);
            this.Status = 0;
            AscFonts.CreateNativeStreamByIndex(stream_index);
        }
        else
        {
            this.Status = 1;
        }

        return true;
    };

    const fontstyle_mask_regular    = 1;
    const fontstyle_mask_italic     = 2;
    const fontstyle_mask_bold       = 4;
    const fontstyle_mask_bolditalic = 8;

    function GenerateMapId(api, name, style, size)
    {
        var fontInfo = api.FontLoader.fontInfos[api.FontLoader.map_font_index[name]];
        let info = fontInfo.GetNeedInfo(style);

        var _ext = "";
        if (info.needB)
            _ext += "nbold";
        if (info.needI)
            _ext += "nitalic";

        // index != -1 (!!!)
        let fontfile = api.FontLoader.fontFiles[info.index];
        return fontfile.Id + info.faceIndex + size + _ext;
    }

    function CFontInfo(sName, thumbnail, indexR, faceIndexR, indexI, faceIndexI, indexB, faceIndexB, indexBI, faceIndexBI)
    {
        this.Name = sName;
        this.Thumbnail = thumbnail;
        this.NeedStyles = 0;

        this.indexR     = indexR;
        this.faceIndexR = faceIndexR;
        this.needR      = false;

        this.indexI     = indexI;
        this.faceIndexI = faceIndexI;
        this.needI      = false;

        this.indexB     = indexB;
        this.faceIndexB = faceIndexB;
        this.needB      = false;

        this.indexBI    = indexBI;
        this.faceIndexBI= faceIndexBI;
        this.needBI     = false;
    }

    CFontInfo.prototype =
    {
        // start loading required styles
        CheckFontLoadStyles : function(global_loader)
        {
            if (isLoadFontsSync)
                return false;

            if ((this.NeedStyles & 0x0F) === 0x0F)
            {
                this.needR = true;
                this.needI = true;
                this.needB = true;
                this.needBI = true;
            }
            else
            {
                let needs = [false, false, false, false];
                if ((this.NeedStyles & fontstyle_mask_regular) !== 0)
                    needs[this.GetBaseStyle(FontStyle.FontStyleRegular)] = true;
                if ((this.NeedStyles & fontstyle_mask_italic) !== 0)
                    needs[this.GetBaseStyle(FontStyle.FontStyleItalic)] = true;
                if ((this.NeedStyles & fontstyle_mask_bold) !== 0)
                    needs[this.GetBaseStyle(FontStyle.FontStyleBold)] = true;
                if ((this.NeedStyles & fontstyle_mask_bolditalic) !== 0)
                    needs[this.GetBaseStyle(FontStyle.FontStyleBoldItalic)] = true;

                if (needs[0]) this.needR = true;
                if (needs[1]) this.needI = true;
                if (needs[2]) this.needB = true;
                if (needs[3]) this.needBI = true;
            }

            var fonts = global_loader.fontFiles;
            var basePath = global_loader.fontFilesPath;
            var isNeed = false;
            if ((this.needR === true) && (-1 !== this.indexR) && (fonts[this.indexR].CheckLoaded() === false))
            {
                fonts[this.indexR].LoadFontAsync(basePath, null);
                isNeed = true;
            }
            if ((this.needI === true) && (-1 !== this.indexI) && (fonts[this.indexI].CheckLoaded() === false))
            {
                fonts[this.indexI].LoadFontAsync(basePath, null);
                isNeed = true;
            }
            if ((this.needB === true) && (-1 !== this.indexB) && (fonts[this.indexB].CheckLoaded() === false))
            {
                fonts[this.indexB].LoadFontAsync(basePath, null);
                isNeed = true;
            }
            if ((this.needBI === true) && (-1 !== this.indexBI) && (fonts[this.indexBI].CheckLoaded() === false))
            {
                fonts[this.indexBI].LoadFontAsync(basePath, null);
                isNeed = true;
            }

            return isNeed;
        },

        // check if at least one font from the family needs to be loaded
        CheckFontLoadStylesNoLoad : function(global_loader)
        {
            if (isLoadFontsSync)
                return false;
            var fonts = global_loader.fontFiles;
            if ((-1 !== this.indexR) && (fonts[this.indexR].CheckLoaded() === false))
                return true;
            if ((-1 !== this.indexI) && (fonts[this.indexI].CheckLoaded() === false))
                return true;
            if ((-1 !== this.indexB) && (fonts[this.indexB].CheckLoaded() === false))
                return true;
            if ((-1 !== this.indexBI) && (fonts[this.indexBI].CheckLoaded() === false))
                return true;
            return false;
        },

        // used only in test example
        LoadFontsFromServer : function(global_loader)
        {
            var fonts = global_loader.fontFiles;
            var basePath = global_loader.fontFilesPath;
            if ((-1 !== this.indexR) && (fonts[this.indexR].CheckLoaded() === false))
                fonts[this.indexR].LoadFontAsync(basePath, null);
            if ((-1 !== this.indexI) && (fonts[this.indexI].CheckLoaded() === false))
                fonts[this.indexI].LoadFontAsync(basePath, null);
            if ((-1 !== this.indexB) && (fonts[this.indexB].CheckLoaded() === false))
                fonts[this.indexB].LoadFontAsync(basePath, null);
            if ((-1 !== this.indexBI) && (fonts[this.indexBI].CheckLoaded() === false))
                fonts[this.indexBI].LoadFontAsync(basePath, null);
        },

        LoadFont : function(font_loader, fontManager, fEmSize, style, dHorDpi, dVerDpi, transform, isNoSetupToManager)
        {
            let info = this.GetNeedInfo(style);
            let fontfile = font_loader.fontFiles[info.index];

            if (window["NATIVE_EDITOR_ENJINE"] && fontfile.Status !== 0)
                fontfile.LoadFontNative();

            var pFontFile = fontManager.LoadFont(fontfile, info.faceIndex, fEmSize,
                (0 !== (style & FontStyle.FontStyleBold)) ? true : false,
                (0 !== (style & FontStyle.FontStyleItalic)) ? true : false,
                info.needB, info.needI,
                isNoSetupToManager);

            if (!pFontFile && -1 === fontfile.stream_index && true === AscFonts.IsLoadFontOnCheckSymbols && true != AscFonts.IsLoadFontOnCheckSymbolsWait)
            {
                // in pdf/xps formats - we don't run symbols through the checker when opening,
                // since symbols should be in the embedded font. But what if not?
                // then we load the font IMMEDIATELY during rendering - and redraw on load
                // we got here only if the symbol went through the checker
                AscFonts.IsLoadFontOnCheckSymbols = false;
                AscFonts.IsLoadFontOnCheckSymbolsWait = true;
                AscFonts.FontPickerByCharacter.loadFonts(window.editor, function ()
                {
                    AscFonts.IsLoadFontOnCheckSymbolsWait = false;
                    this.WordControl && this.WordControl.private_RefreshAll();
                });
            }

            if (pFontFile && (true !== isNoSetupToManager))
            {
                var newEmSize = fontManager.UpdateSize(fEmSize, dVerDpi, dVerDpi);
                pFontFile.SetSizeAndDpi(newEmSize, dHorDpi, dVerDpi);

                if (undefined !== transform)
                {
                    fontManager.SetTextMatrix2(transform.sx,transform.shy,transform.shx,transform.sy,transform.tx,transform.ty);
                }
                else
                {
                    fontManager.SetTextMatrix(1, 0, 0, 1, 0, 0);
                }
            }

            return pFontFile;
        },

        GetFontID : function(font_loader, style)
        {
            let info = this.GetNeedInfo(style);
            let fontfile = font_loader.fontFiles[info.index];
            return { id: fontfile.Id, faceIndex : info.faceIndex, file : fontfile };
        },

        // based on the requested style - return which one we will use
        GetBaseStyle : function(style)
        {
            switch (style)
            {
                case FontStyle.FontStyleBoldItalic:
                {
                    if (-1 !== this.indexBI)
                        return FontStyle.FontStyleBoldItalic;
                    else if (-1 !== this.indexB)
                        return FontStyle.FontStyleBold;
                    else if (-1 !== this.indexI)
                        return FontStyle.FontStyleItalic;
                    else
                        return FontStyle.FontStyleRegular;
                    break;
                }
                case FontStyle.FontStyleBold:
                {
                    if (-1 !== this.indexB)
                        return FontStyle.FontStyleBold;
                    else if (-1 !== this.indexR)
                        return FontStyle.FontStyleRegular;
                    else if (-1 !== this.indexBI)
                        return FontStyle.FontStyleBoldItalic;
                    else
                        return FontStyle.FontStyleItalic;
                    break;
                }
                case FontStyle.FontStyleItalic:
                {
                    if (-1 !== this.indexI)
                        return FontStyle.FontStyleItalic;
                    else if (-1 !== this.indexR)
                        return FontStyle.FontStyleRegular;
                    else if (-1 !== this.indexBI)
                        return FontStyle.FontStyleBoldItalic;
                    else
                        return FontStyle.FontStyleBold;
                    break;
                }
                case FontStyle.FontStyleRegular:
                {
                    if (-1 !== this.indexR)
                        return FontStyle.FontStyleRegular;
                    else if (-1 !== this.indexI)
                        return FontStyle.FontStyleItalic;
                    else if (-1 !== this.indexB)
                        return FontStyle.FontStyleBold;
                    else
                        return FontStyle.FontStyleBoldItalic;
                }
            }
            return FontStyle.FontStyleRegular;
        },

        // based on the requested style - return which one we will load and what settings need to be applied manually
        GetNeedInfo : function(style)
        {
            let result = {
                index : -1,
                faceIndex : 0,
                needB : false,
                needI : false
            };

            let resStyle = this.GetBaseStyle(style);

            switch (resStyle)
            {
                case FontStyle.FontStyleBoldItalic:
                {
                    result.index = this.indexBI;
                    result.faceIndex = this.faceIndexBI;
                    break;
                }
                case FontStyle.FontStyleBold:
                {
                    result.index = this.indexB;
                    result.faceIndex = this.faceIndexB;
                    if (0 !== (style & FontStyle.FontStyleItalic))
                        result.needI = true;
                    break;
                }
                case FontStyle.FontStyleItalic:
                {
                    result.index = this.indexI;
                    result.faceIndex = this.faceIndexI;
                    if (0 !== (style & FontStyle.FontStyleBold))
                        result.needB = true;
                    break;
                }
                case FontStyle.FontStyleRegular:
                default:
                {
                    result.index = this.indexR;
                    result.faceIndex = this.faceIndexR;
                    if (0 !== (style & FontStyle.FontStyleItalic))
                        result.needI = true;
                    if (0 !== (style & FontStyle.FontStyleBold))
                        result.needB = true;
                    break;
                }
            }

            return result;
        }
    };

    function CFontInfoEmbed(name, index)
    {
        this.Name = name;
        this.indexR     = index;
        this.faceIndexR = 0;
    }

    CFontInfoEmbed.prototype =
    {
        // start loading required styles
        CheckFontLoadStyles : function(global_loader)
        {
            let fontFile = global_loader.fontFiles[this.indexR];
            fontFile.LoadFontAsync();
            return false;
        },

        // check if at least one font from the family needs to be loaded
        CheckFontLoadStylesNoLoad : function(global_loader)
        {
            return false;
        },

        LoadFont : function(font_loader, fontManager, fEmSize, style, dHorDpi, dVerDpi, transform, isNoSetupToManager)
        {
            let fontfile = font_loader.fontFiles[this.indexR];

            var pFontFile = fontManager.LoadFont(fontfile, this.faceIndexR, fEmSize,
                false,
                false,
                false, false,
                isNoSetupToManager);

            if (pFontFile && (true !== isNoSetupToManager))
            {
                pFontFile.m_pFaceInfo.family_name = this.Name;

                var newEmSize = fontManager.UpdateSize(fEmSize, dVerDpi, dVerDpi);
                pFontFile.SetSizeAndDpi(newEmSize, dHorDpi, dVerDpi);

                if (undefined !== transform)
                {
                    fontManager.SetTextMatrix2(transform.sx,transform.shy,transform.shx,transform.sy,transform.tx,transform.ty);
                }
                else
                {
                    fontManager.SetTextMatrix(1, 0, 0, 1, 0, 0);
                }
            }

            return pFontFile;
        },

        GetFontID : function(font_loader)
        {
            let fontfile = font_loader.fontFiles[this.indexК];
            return { id: fontfile.Id, faceIndex : this.faceIndexR, file : fontfile };
        }
    };

    // thumbnail - this is the position (y) in the common thumbnail of all fonts
    function CFont(name, id, thumbnail, style)
    {
        this.name       = name;
        this.id         = id || "";
        this.thumbnail  = thumbnail || 0;
        this.NeedStyles = style || (fontstyle_mask_regular | fontstyle_mask_italic | fontstyle_mask_bold | fontstyle_mask_bolditalic);
    }

    CFont.prototype["asc_getFontId"] = CFont.prototype.asc_getFontId = function() { return this.id; };
    CFont.prototype["asc_getFontName"] = CFont.prototype.asc_getFontName = function()
    {
        var _name = AscFonts.g_fontApplication ? AscFonts.g_fontApplication.NameToInterface[this.name] : null;
        return _name ? _name : this.name;
    };
    CFont.prototype["asc_getFontThumbnail"] = CFont.prototype.asc_getFontThumbnail = function() { return this.thumbnail; };
    // for compatibility
    CFont.prototype["asc_getFontType"] = CFont.prototype.asc_getFontType = function() { return 1; };

    var ImageLoadStatus =
    {
        Loading : 0,
        Complete : 1
    };

    function CImage(src)
    {
        this.src    = src;
        this.Image  = null;
        this.Status = ImageLoadStatus.Complete;
    }

	function checkAllFonts()
    {
        if (undefined === window["__fonts_files"] && window["native"] && window["native"]["GenerateAllFonts"])
            window["native"]["GenerateAllFonts"]();

        if (undefined === window["__fonts_files"])
            return;

        let g_font_files, g_font_infos;

        var files = window["__fonts_files"];

		let count_files = files ? files.length : 0;
		g_font_files = new Array(count_files);
		for (let i = 0; i < count_files; i++)
		{
			g_font_files[i] = new CFontFileLoader(files[i]);
		}

		let infos = window["__fonts_infos"];
		let count_infos = infos ? infos.length : 0;
		g_font_infos = new Array(count_infos);

		let curIndex = 0;
		for (let i = 0; i < count_infos; i++)
		{
			let info = infos[i];

			g_font_infos[curIndex] = new CFontInfo(info[0], i, info[1], info[2], info[3], info[4], info[5], info[6], info[7], info[8]);
			g_map_font_index[info[0]] = curIndex;
			curIndex++;
		}

        g_font_infos.length = curIndex;


        if (AscFonts.FontPickerByCharacter)
            AscFonts.FontPickerByCharacter.init(window["__fonts_infos"]);

		// delete temporary variables
		delete window["__fonts_files"];
		delete window["__fonts_infos"];

        window['AscFonts'].g_font_files = g_font_files;
        window['AscFonts'].g_font_infos = g_font_infos;
	}

    //------------------------------------------------------export------------------------------------------------------
    window['AscFonts'] = window['AscFonts'] || {};
    window['AscFonts'].g_map_font_index = g_map_font_index;
    window['AscFonts'].g_fonts_streams  = g_fonts_streams;

    window['AscFonts'].CFontFileLoader = CFontFileLoader;
    window['AscFonts'].GenerateMapId = GenerateMapId;
    window['AscFonts'].CFontInfo = CFontInfo;
    window['AscFonts'].CFont = CFont;

    window['AscFonts'].CFontFileLoaderEmbed = CFontFileLoaderEmbed;
    window['AscFonts'].CFontInfoEmbed = CFontInfoEmbed;

    window['AscFonts'].ImageLoadStatus = ImageLoadStatus;
    window['AscFonts'].CImage = CImage;

    window['AscFonts'].checkAllFonts = checkAllFonts;

    window['AscFonts'].g_font_infos_embed = [];
    window['AscFonts'].g_map_font_index_embed = {};


    window['AscFonts'].getEmbeddedFontPrefix = function()
    {
        return "Embedded: ";
    };

    window['AscFonts'].initEmbeddedFonts = function(fonts, isMerge)
    {
        const prefix = AscFonts.getEmbeddedFontPrefix();
        let fontFiles = AscFonts.g_font_files;

        if (!isMerge)
        {
            if (CFontFileLoaderEmbed.prototype.startIndex > 0)
                fontFiles.splice(CFontFileLoaderEmbed.prototype.startIndex);

            CFontFileLoaderEmbed.prototype.startIndex = fontFiles.length;
            let currentIndex = CFontFileLoaderEmbed.prototype.startIndex;

            for (let i = 0, len = fonts.length; i < len; i++)
            {
                let name = prefix + fonts[i];
                AscFonts.g_font_files.push(new CFontFileLoaderEmbed(name));
                AscFonts.g_font_infos_embed.push(new CFontInfoEmbed(name, currentIndex++));
                AscFonts.g_map_font_index_embed[name] = i;
            }
        }
        else
        {
            let startIndex = CFontFileLoaderEmbed.prototype.startIndex;
            let endIndex = fontFiles.length;
            let currentIndex = endIndex;

            for (let i = 0, len = fonts.length; i < len; i++)
            {
                let name = prefix + fonts[i];

                let isFound = false;
                for (let j = startIndex; j < endIndex; j++)
                {
                    if (fontFiles[j].Id === name)
                    {
                        isFound = true;
                        break;
                    }
                }

                if (isFound)
                    continue;

                AscFonts.g_font_files.push(new CFontFileLoaderEmbed(name));
                AscFonts.g_map_font_index_embed[name] = AscFonts.g_font_infos_embed.length;
                AscFonts.g_font_infos_embed.push(new CFontInfoEmbed(name, currentIndex++));
            }
        }
    };

    checkAllFonts();

})(window, window.document);

// initially wanted to implement "eviction" from this map.
// but then we would need to store base64 strings. That's not cool. Memory-wise - even
// there will be a gain. Fonts don't compress well with lzw or deflate
// so it's better to delete base64 strings from memory
// ----------------------------------------------------------------------------
