/* exported createFreeAnnouncementForm */
/* global btsAnnouncementEditor */
'use strict';

let freeAnnouncementDialogSequence = 0;

function createFreeAnnouncementForm({ form, textarea, localButton, remoteButton, service, readiness, playLocal, playRemote, getTournament = () => ({}) }) {
    const doc = form.ownerDocument;
    const buttons = [localButton, remoteButton];
    const readText = () => textarea.value.trim();
    const signature = () => {
        const value = service.settings();
        return JSON.stringify([value.key, value.voice, value.language, value.mode, value.enabled, value.max_part_length, value.max_text]);
    };
    const prefix = 'free-announcement-playback-' + (++freeAnnouncementDialogSequence);
    const editor = btsAnnouncementEditor.create({ textarea, getTournament, getKey: () => service.settings().key });
    const lifetime = new AbortController(), { signal: lifetimeSignal } = lifetime;
    function el(parent, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        parent.append(node);
        return node;
    }
    function text(node, value) { if (node.textContent !== value) node.textContent = value; }
    function icon(parent, path) {
        const node = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        node.setAttribute('class', 'ico');node.setAttribute('viewBox', '0 0 24 24');node.setAttribute('aria-hidden', 'true');
        const shape = doc.createElementNS('http://www.w3.org/2000/svg', 'path');shape.setAttribute('d', path);node.append(shape);parent.append(node);
        return shape;
    }
    const menu = el(form, 'dialog', 'leitstand-dialog is-warning announcement-playback-menu');
    menu.id = prefix;menu.setAttribute('role', 'alertdialog');
    menu.setAttribute('aria-labelledby', prefix + '-title');menu.setAttribute('aria-describedby', prefix + '-status');
    const header = el(menu, 'div', 'dialog-heading'), heading = el(header, 'h2');heading.id = prefix + '-title';
    const headingIcon = icon(heading, 'm12 3 10 18H2Z M12 9v5M12 17v1');
    const caption = el(heading, 'span');
    const closeButton = el(header, 'button', 'ls-dialog-close');closeButton.type = 'button';closeButton.setAttribute('aria-label', 'Schließen');
    icon(closeButton, 'm6 6 12 12M6 18 18 6');
    const body = el(menu, 'div', 'dialog-content');
    const target = el(body, 'p', 'announcement-target');el(target, 'strong', '', 'Ausgabeziel');
    const targetText = el(target, 'span');
    const preview = el(body, 'section', 'announcement-preview');
    const previewHeading = el(preview, 'h3', '', 'Durchsagentext');previewHeading.id = prefix + '-preview';preview.setAttribute('aria-labelledby', previewHeading.id);
    const previewText = el(preview, 'p', 'announcement-preview-text');
    const detail = el(body, 'p', 'announcement-status');detail.id = prefix + '-status';
    detail.setAttribute('role', 'status');
    const footer = el(menu, 'div', 'ls-dialog-footer');
    function option(text, className) {
        const button = el(footer, 'button', 'btn ' + className, text);
        button.type = 'button';
        return button;
    }
    const cancelButton = option('Abbrechen', 'announcement-cancel-button');
    const browserButton = option('Mit Browserstimme abspielen', 'announcement-browser-button');
    const backgroundLabel = 'Im Hintergrund warten und abspielen';
    const backgroundButton = option('', 'announcement-background-button primary');
    const backgroundText = el(backgroundButton, 'span', 'announcement-action-label', backgroundLabel);
    backgroundButton.dataset.sizingLabel = backgroundLabel;
    backgroundButton.setAttribute('aria-describedby', detail.id);
    const pending = el(form, 'div', 'announcement-pending');pending.hidden = true;
    const pendingStatus = el(pending, 'p', 'announcement-pending-status');pendingStatus.id = prefix + '-pending-status';pendingStatus.setAttribute('role', 'status');
    const pendingText = el(pending, 'p', 'announcement-pending-text');pendingText.id = prefix + '-pending-text';
    const pendingActions = el(pending, 'div', 'announcement-pending-actions');
    const pendingRetry = el(pendingActions, 'button', 'btn announcement-pending-retry', 'Erneut versuchen');pendingRetry.type = 'button';
    const pendingCancel = el(pendingActions, 'button', 'btn announcement-pending-cancel', 'Abbrechen');pendingCancel.type = 'button';
    for (const button of [pendingRetry, pendingCancel]) button.setAttribute('aria-describedby', pendingStatus.id + ' ' + pendingText.id);
    let selected = null;
    let waiting = null;
    let failure = null;
    let background = false;
    let draftTimer;
    const stateObserver = new MutationObserver(() => render());
    const ownerObserver = new MutationObserver(() => { if (!form.isConnected) dispose(); });

    function updateButtons() {
        for (const button of buttons) button.disabled = !readText() || !!waiting;
    }
    function stopWaiting() {
        waiting?.abort();
        waiting = null;
        buttons.forEach(button => button.classList.remove('is-waiting'));
        updateButtons();
    }
    function close(restoreFocus = true) {
        const trigger = selected?.button;
        stateObserver.disconnect();ownerObserver.disconnect();
        stopWaiting();
        selected = null;
        failure = null;
        background = false;pending.hidden = true;
        buttons.forEach(button => button.setAttribute('aria-expanded', 'false'));
        if (menu.open) menu.close();
        if (restoreFocus && trigger) {
            const target = trigger?.isConnected && !trigger.disabled ? trigger : textarea.isConnected ? textarea : null;
            target?.focus({preventScroll: true});
        }
    }
    function current(choice) {
        return selected === choice && form.isConnected && (background || readText() === choice.text) && signature() === choice.signature;
    }
    function waitReason(text) {
        const value = service.settings();
        if (!value.enabled) return 'Die Sprachausgabe ist ausgeschaltet.';
        if (!value.key) return 'Es ist kein Turnier für die Sprachausgabe ausgewählt.';
        if (value.mode === 'browser') return 'Die Browserstimme ist ausgewählt.';
        if (value.language !== 'de-DE') return 'Für die gewählte Sprache steht kein Serveraudio zur Verfügung.';
        const limit = value.max_part_length || value.max_text || 1200;
        return text.length > limit ? 'Der Text ist für das Serveraudio zu lang (maximal ' + limit + ' Zeichen).' : '';
    }
    function render() {
        if (!selected) return;
        if (!current(selected)) { close(false);return; }
        if (background) {
            pending.hidden = false;
            const error = !!failure && !waiting;
            pending.classList.toggle('is-error', error);pendingStatus.setAttribute('role', error ? 'alert' : 'status');
            text(pendingStatus, (selected.remote ? 'Remote' : 'Lokal') + ' · ' + (error ? failure : 'Durchsage wartet im Hintergrund auf Serveraudio.'));
            text(pendingText, selected.text);
            pending.title = pendingStatus.textContent + '\n' + selected.text;
            pendingRetry.hidden = !error;
            const reason = waitReason(selected.text);pendingRetry.disabled = !!waiting || !!reason;pendingRetry.title = reason;
            return;
        }
        const state = selected.button.dataset.speechState, ready = state === 'ready';
        if (ready) failure = null;
        const reason = waitReason(selected.text);
        menu.classList.toggle('is-warning', !ready);
        const path = ready ? 'm5 12 4 4L20 5' : 'm12 3 10 18H2Z M12 9v5M12 17v1';
        if (headingIcon.getAttribute('d') !== path) headingIcon.setAttribute('d', path);
        text(caption, ready ? 'Durchsage ist bereit' : 'Durchsage noch nicht bereit');
        const messages = {
            preparing: 'Das Serveraudio wird noch vorbereitet.',
            checking: 'Die Verfügbarkeit des Serveraudios wird geprüft.',
            failed: 'Das Serveraudio konnte nicht erzeugt werden. Sie können es erneut versuchen.',
            unavailable: 'Der Status des Serveraudios ist zurzeit nicht verfügbar.',
            locked: 'Die Audioausgabe auf diesem Gerät wartet noch auf eine Freigabe.',
            audio_error: 'Das Serveraudio konnte auf diesem Gerät nicht abgespielt werden.',
        };
        const error = !reason && !ready && ['failed', 'audio_error', 'unavailable'].includes(state);
        text(detail, reason || (ready ? 'Das Serveraudio ist bereit und kann jetzt abgespielt werden.' :
            messages[state] || 'Für diesen Text liegt noch kein fertiges Serveraudio vor.'));
        detail.classList.toggle('is-error', error);detail.setAttribute('role', error ? 'alert' : 'status');
        backgroundButton.disabled = !!reason;
        backgroundButton.title = reason || (ready ? 'Die bestätigte Durchsage jetzt mit Serveraudio abspielen.' :
            'Dialog schließen und die bestätigte Durchsage abspielen, sobald das Serveraudio bereit ist.');
        text(backgroundText, ready ? 'Jetzt abspielen' : backgroundLabel);
        browserButton.hidden = service.settings().mode !== 'auto';
    }
    function play(choice, mode) {
        if (!current(choice)) { close(false); return; }
        if (mode === 'browser' && !['auto', 'browser'].includes(service.settings().mode)) return;
        close(!background);
        const sent = (choice.remote ? playRemote : playLocal)(choice.text, mode);
        const remember = () => editor.remember(choice.text, choice.key);
        if (sent?.then) Promise.resolve(sent).then(remember, () => {});else if (sent !== false) remember();
    }
    function choose(button, remote) {
        if (waiting) return;
        const text = readText();
        if (!text) return;
        editor.close();
        close(false);
        const choice = selected = { button, remote, text, key: service.settings().key, signature: signature() };
        if (button.dataset.speechState === 'ready' || service.settings().mode === 'browser') {
            play(choice, service.settings().mode === 'browser' ? 'browser' : undefined);
            return;
        }
        targetText.textContent = remote ? 'Geräte mit aktivierten freien Durchsagen' : 'Dieses Gerät';
        previewText.textContent = text;
        render();
        button.setAttribute('aria-expanded', 'true');
        stateObserver.observe(button, {attributes: true, attributeFilter: ['data-speech-state', 'title']});
        ownerObserver.observe(doc.body, {childList: true, subtree: true});
        menu.showModal();
        (backgroundButton.disabled ? browserButton.hidden ? cancelButton : browserButton : backgroundButton).focus();
    }
    function minimize() {
        background = true;render();
        buttons.forEach(button => button.setAttribute('aria-expanded', 'false'));
        if (menu.open) menu.close();
        pendingCancel.focus({preventScroll: true});
    }
    async function waitInBackground() {
        const choice = selected;
        if (!choice || !current(choice) || waitReason(choice.text) || waiting) return;
        if (!background && choice.button.dataset.speechState === 'ready') { play(choice, 'server');return; }
        if (!background) clearTimeout(draftTimer);
        failure = null;
        const controller = waiting = new AbortController();
        const signal = controller.signal;
        const active = () => !signal.aborted && waiting === controller && current(choice);
        choice.button.classList.add('is-waiting');
        updateButtons();
        minimize();
        try {
            const prepared = await service.prepare([choice.text], {urgent: true});
            if (signal.aborted) return;
            if (!current(choice)) { close(false);return; }
            if (prepared === null || prepared?.speech_error || prepared?.speech?.enabled === false) {
                failure = 'Serveraudio konnte nicht angefordert werden. Bitte erneut versuchen.';
                return;
            }
            while (!signal.aborted) {
                if (!current(choice)) { close(false); return; }
                const response = await service.inspect([choice.text]);
                if (signal.aborted) return;
                if (!current(choice)) { close(false); return; }
                if (!response || response.speech_error || response.speech?.enabled === false || !Array.isArray(response.clips) || response.clips.length !== 1 || !response.clips[0]) {
                    failure = 'Der Status des Serveraudios konnte nicht abgerufen werden. Bitte erneut versuchen.';
                    return;
                }
                if (response.clips[0].status === 'completed') {
                    readiness?.changed(true);
                    play(choice, 'server');
                    return;
                }
                if (response.clips.some(clip => clip.status === 'failed')) {
                    readiness?.changed(true);
                    failure = 'Die Vorbereitung ist fehlgeschlagen. Bitte erneut versuchen.';
                    return;
                }
                await new Promise(resolve => {
                    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
                    const timer = setTimeout(finish, 1000);
                    signal.addEventListener('abort', finish, { once: true });
                });
            }
        } catch (_) {
            if (active()) failure = 'Serveraudio konnte nicht vorbereitet werden. Bitte erneut versuchen.';
        } finally {
            if (waiting === controller) {
                stopWaiting();
                render();
            }
        }
    }
    function dispose() {
        close(false);clearTimeout(draftTimer);lifetime.abort();editor.destroy();menu.remove();pending.remove();
    }
    for (const button of buttons) {
        button.classList.add('announcement-playback-button');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', menu.id);
        button.setAttribute('aria-expanded', 'false');
        readiness?.trackText(button, () => readText() ? [readText()] : [], false, { remote: button === remoteButton });
    }
    localButton.addEventListener('click', () => choose(localButton, false), {signal: lifetimeSignal});
    form.addEventListener('submit', event => { event.preventDefault(); choose(remoteButton, true); }, {signal: lifetimeSignal});
    backgroundButton.addEventListener('click', () => { void waitInBackground(); }, {signal: lifetimeSignal});
    pendingRetry.addEventListener('click', () => { void waitInBackground(); }, {signal: lifetimeSignal});
    pendingCancel.addEventListener('click', () => close(), {signal: lifetimeSignal});
    browserButton.addEventListener('click', () => { if (selected) play(selected, 'browser'); }, {signal: lifetimeSignal});
    cancelButton.addEventListener('click', () => close(), {signal: lifetimeSignal});
    closeButton.addEventListener('click', () => close(), {signal: lifetimeSignal});
    menu.addEventListener('cancel', event => { event.preventDefault(); close(); }, {signal: lifetimeSignal});
    menu.addEventListener('close', () => { if (!menu.open && !background) close(); }, {signal: lifetimeSignal});
    textarea.addEventListener('input', () => {
        if (!background) close(false);
        readiness?.changed();
        clearTimeout(draftTimer);
        const draftSignature = signature();
        draftTimer = setTimeout(() => {
            const text = readText();
            if (text && textarea.isConnected && signature() === draftSignature) void service.prepare([text]);
        }, 1500);
        updateButtons();
    }, {signal: lifetimeSignal});
    updateButtons();
    return {dispose};
}

if (typeof module !== 'undefined' && module.exports) module.exports = createFreeAnnouncementForm;
