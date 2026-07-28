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

test('unSaveLock publishes server-confirmed indexes after applying metadata', () => {
    const api = createDocsCoApi();
    const confirmations = [];
    const states = [];
    api.onServerSaveConfirmed = fact => confirmations.push({...fact});
    api.onServerSaveStateChanged = fact => states.push({...fact});
    api._CoAuthoringApi.onServerSaveConfirmed = fact => api.callback_OnServerSaveConfirmed(fact);
    api._CoAuthoringApi.onServerSaveStateChanged = fact => api.callback_OnServerSaveStateChanged(fact);
    api._CoAuthoringApi._sendBufferedLocks = () => {};
    api._CoAuthoringApi._send = () => {};

    api._CoAuthoringApi.saveChanges(['change'], null);
    api._CoAuthoringApi._reSaveChanges(1);

    api._CoAuthoringApi._onUnSaveLock({index: 7, syncChangesIndex: 9, time: 42});

    assert.deepEqual(confirmations, [{
        changesIndex: 7,
        syncChangesIndex: 9,
        time: 42,
        sequence: 1
    }]);
    assert.deepEqual(states, [
        {state: 'saving', sequence: 1},
        {state: 'retrying', sequence: 2, reason: 1},
        {
            state: 'confirmed',
            sequence: 3,
            changesIndex: 7,
            syncChangesIndex: 9,
            time: 42,
            confirmationSequence: 1
        }
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
        'asc_onServerSaveStateChanged',
        'asc_onServerSaveConfirmed'
    ]) {
        assert.match(apiBaseSource, new RegExp(callbackName));
    }

    for (const phase of [
        'connecting',
        'authenticating',
        'converting',
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
