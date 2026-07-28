/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const docsCoApiSource = readFileSync(new URL('../../common/docscoapi.js', import.meta.url), 'utf8');
const apiBaseSource = readFileSync(new URL('../../common/apiBase.js', import.meta.url), 'utf8');

function createDocsCoApi() {
    const window = {
        Asc: {},
        AscCommon: {
            ConnectionState: {
                Reconnect: -1,
                None: 0,
                WaitAuth: 1,
                Authorized: 2,
                ClosedAll: 4,
                SaveChanges: 5,
                AskSaveChanges: 6
            },
            c_oEditorId: {},
            c_oCloseCode: {drop: 1},
            c_oAscServerCommandErrors: {},
            c_oAscForceSaveTypes: {}
        },
        setTimeout: () => 1,
        clearTimeout: () => {}
    };
    window.window = window;
    vm.runInNewContext(docsCoApiSource, {
        window,
        performance: {now: () => 0},
        setTimeout,
        clearTimeout,
        console
    });
    return new window.AscCommon.CDocsCoApi();
}

test('transport facts are sequenced separately from collaborator presence', () => {
    const api = createDocsCoApi();
    const facts = [];
    api.onTransportStateChanged = fact => facts.push({...fact});
    api._CoAuthoringApi.onTransportStateChanged = fact => api.callback_OnTransportStateChanged(fact);
    api._CoAuthoringApi.onFirstConnect = () => {};

    api._CoAuthoringApi._emitTransportState('connecting', {reconnecting: false});
    api._CoAuthoringApi._onServerOpen();
    api._CoAuthoringApi._onServerClose(false);

    assert.deepEqual(facts, [
        {state: 'connecting', sequence: 1, reconnecting: false},
        {state: 'authenticating', sequence: 2, reconnecting: false},
        {state: 'reconnecting', sequence: 3, explicit: false}
    ]);
});

test('unSaveLock publishes one coauthoring-server acceptance fact after applying metadata', () => {
    const api = createDocsCoApi();
    const states = [];
    api.onServerSaveStateChanged = fact => states.push({...fact});
    api._CoAuthoringApi.onServerSaveStateChanged = fact => api.callback_OnServerSaveStateChanged(fact);
    api._CoAuthoringApi._sendBufferedLocks = () => {};
    api._CoAuthoringApi._send = () => {};

    api._CoAuthoringApi.saveChanges(['change'], null);
    api._CoAuthoringApi._reSaveChanges(1);

    api._CoAuthoringApi._onUnSaveLock({index: 7, syncChangesIndex: 9, time: 42});

    assert.deepEqual(states, [
        {state: 'saving', sequence: 1},
        {state: 'retrying', sequence: 2, attempt: 1},
        {
            state: 'accepted',
            sequence: 3,
            scope: 'coauthoring-server',
            changesIndex: 7,
            syncChangesIndex: 9,
            time: 42
        }
    ]);
});

test('initial collaboration phases bracket application of server changes', () => {
    const api = createDocsCoApi();
    const events = [];
    const coApi = api._CoAuthoringApi;
    api.onFirstLoadChangesStart = () => events.push('apply-start');
    api.onFirstLoadChangesEnd = () => events.push('apply-end');
    coApi.onFirstLoadChangesStart = () => api.callback_OnFirstLoadChangesStart();
    coApi.onFirstLoadChangesEnd = () => api.callback_OnFirstLoadChangesEnd();
    coApi._isAuth = false;
    coApi._user = {asc_getId: () => 'user-'};
    coApi._onRefreshToken = () => {};
    coApi._onServerVersion = () => {};
    coApi._onLicenseChanged = () => {};
    coApi._onAuthParticipantsChanged = () => {};
    coApi._onSpellCheckInit = () => {};
    coApi._onSetIndexUser = () => {};
    coApi._onMessages = () => {};
    coApi._onGetLock = () => {};
    coApi._updateAuthChanges = () => events.push('server-changes-applied');
    coApi._applyPrebuffered = () => {};
    coApi._sendPrebuffered = () => {};

    coApi._onAuth({jwt: 'token', result: 1, indexUser: 2, participants: []});

    assert.deepEqual(events, [
        'apply-start',
        'server-changes-applied',
        'apply-end'
    ]);
});

test('transport loss classifies active save failures before reconnect handling', () => {
    const retryableApi = createDocsCoApi();
    const retryableStates = [];
    retryableApi.onServerSaveStateChanged = fact => retryableStates.push({...fact});
    retryableApi._CoAuthoringApi.onServerSaveStateChanged = fact =>
        retryableApi.callback_OnServerSaveStateChanged(fact);
    retryableApi._CoAuthoringApi._state = 5;
    retryableApi._CoAuthoringApi._onServerClose(false);

    assert.deepEqual(retryableStates, [{
        state: 'retryable-failed',
        sequence: 1,
        reason: 'transport-lost'
    }]);

    const blockingApi = createDocsCoApi();
    const blockingStates = [];
    blockingApi.onServerSaveStateChanged = fact => blockingStates.push({...fact});
    blockingApi._CoAuthoringApi.onServerSaveStateChanged = fact =>
        blockingApi.callback_OnServerSaveStateChanged(fact);
    blockingApi._CoAuthoringApi._state = 5;
    blockingApi._CoAuthoringApi._onServerClose(true);

    assert.deepEqual(blockingStates, [{
        state: 'blocking-failed',
        sequence: 1,
        reason: 'transport-closed'
    }]);
});

test('reauthentication stays reconciling until buffered server state is applied', () => {
    const api = createDocsCoApi();
    const events = [];
    const coApi = api._CoAuthoringApi;
    api.onTransportStateChanged = fact => events.push(fact.state);
    coApi.onTransportStateChanged = fact => api.callback_OnTransportStateChanged(fact);
    coApi._isAuth = true;
    coApi._onRefreshToken = () => {};
    coApi._onServerVersion = () => {};
    coApi._onLicenseChanged = () => {};
    coApi._onAuthParticipantsChanged = () => {};
    coApi._onMessages = () => {};
    coApi._onGetLock = () => {};
    coApi._applyPrebuffered = () => events.push('server-state-applied');

    coApi._onAuth({jwt: 'token', participants: []});

    assert.deepEqual(events, ['reconciling', 'server-state-applied', 'connected']);
});

test('reauthentication without coauthoring still completes transport reconciliation', () => {
    const api = createDocsCoApi();
    const states = [];
    const coApi = api._CoAuthoringApi;
    api.onTransportStateChanged = fact => states.push(fact.state);
    coApi.onTransportStateChanged = fact => api.callback_OnTransportStateChanged(fact);
    coApi._isAuth = true;
    coApi.isCloseCoAuthoring = true;
    coApi._onRefreshToken = () => {};
    coApi._onServerVersion = () => {};

    coApi._onAuth({jwt: 'token'});

    assert.deepEqual(states, ['reconciling', 'connected']);
});

test('base editor exposes stable open, transport, and save callback names', () => {
    for (const callbackName of [
        'asc_onDocumentOpenStateChanged',
        'asc_onTransportStateChanged',
        'asc_onServerSaveStateChanged'
    ]) {
        assert.match(apiBaseSource, new RegExp(callbackName));
    }
    assert.doesNotMatch(apiBaseSource, /asc_onServerSaveConfirmed/);
    assert.doesNotMatch(docsCoApiSource, /onServerSaveConfirmed/);

    for (const phase of [
        'connecting',
        'authenticating',
        'requestingDocument',
        'downloading',
        'parsing',
        'applyingChanges',
        'loadingResources',
        'ready',
        'failed'
    ]) {
        const source = phase === 'loadingResources'
            ? readFileSync(new URL('../../word/api.js', import.meta.url), 'utf8')
            : apiBaseSource;
        assert.match(source, new RegExp(`['"]${phase}['"]`));
    }
});
