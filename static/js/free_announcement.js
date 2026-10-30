/* exported createFreeAnnouncementForm */
'use strict';

function createFreeAnnouncementForm({ form, textarea, localButton, remoteButton, service, readiness, playLocal, playRemote }) {
    const doc = form.ownerDocument;
    const buttons = [localButton, remoteButton];
    const readText = () => textarea.value.trim();
    const signature = () => {
        const value = service.settings();
        return JSON.stringify([value.key, value.voice, value.language, value.mode, value.enabled]);
    };
    const menu = doc.createElement('dialog');
    menu.className = 'announcement-playback-menu';
    menu.id = 'free-announcement-playback-menu';
    menu.setAttribute('aria-labelledby', 'free-announcement-playback-title');
    const heading = doc.createElement('strong');
    heading.id = 'free-announcement-playback-title';
    menu.append(heading);
    const detail = doc.createElement('p');
    detail.setAttribute('role', 'status');
    menu.append(detail);
    function option(text, className) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = text;
        menu.append(button);
        return button;
    }
    const waitButton = option('Warten und abspielen', 'announcement-wait-button');
    const browserButton = option('Browser verwenden', 'announcement-browser-button');
    const cancelButton = option('Abbrechen', 'announcement-cancel-button');
    form.append(menu);
    let selected = null;
    let waiting = null;
    let draftTimer;

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
        stopWaiting();
        selected = null;
        buttons.forEach(button => button.setAttribute('aria-expanded', 'false'));
        if (menu.open) menu.close();
        if (restoreFocus && trigger?.isConnected) trigger.focus();
    }
    function current(choice) {
        return selected === choice && form.isConnected && readText() === choice.text && signature() === choice.signature;
    }
    function canWait(text) {
        const value = service.settings();
        return value.enabled && value.mode !== 'browser' && value.language === 'de-DE' &&
            text.length <= (value.max_part_length || value.max_text || 1200);
    }
    function play(choice, mode) {
        if (!current(choice)) { close(false); return; }
        if (mode === 'browser' && !['auto', 'browser'].includes(service.settings().mode)) return;
        close();
        (choice.remote ? playRemote : playLocal)(choice.text, mode);
    }
    function choose(button, remote) {
        const text = readText();
        if (!text) return;
        close(false);
        const choice = selected = { button, remote, text, signature: signature() };
        if (button.dataset.speechState === 'ready' || service.settings().mode === 'browser') {
            play(choice, service.settings().mode === 'browser' ? 'browser' : undefined);
            return;
        }
        heading.textContent = (remote ? 'Remote' : 'Lokal') + ': Durchsage noch nicht bereit';
        detail.textContent = canWait(text) ? 'Auf das Serveraudio warten oder die Ausgabe wählen.' :
            'Serveraudio ist für diese Durchsage nicht verfügbar.';
        waitButton.disabled = !canWait(text);
        browserButton.hidden = service.settings().mode !== 'auto';
        button.setAttribute('aria-expanded', 'true');
        menu.showModal();
        const anchor = button.getBoundingClientRect(), rect = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(anchor.left, doc.defaultView.innerWidth - rect.width - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(anchor.bottom + 6, doc.defaultView.innerHeight - rect.height - 8)) + 'px';
        (waitButton.disabled ? browserButton.hidden ? cancelButton : browserButton : waitButton).focus();
    }
    async function wait() {
        const choice = selected;
        if (!choice || !canWait(choice.text)) return;
        stopWaiting();
        const controller = waiting = new AbortController();
        const signal = controller.signal;
        choice.button.classList.add('is-waiting');
        updateButtons();
        waitButton.disabled = true;
        detail.textContent = 'Serveraudio wird vorbereitet. Die Durchsage startet, sobald es bereit ist.';
        try {
            await service.prepare([choice.text]);
            while (!signal.aborted) {
                if (!current(choice)) { close(false); return; }
                const response = await service.inspect([choice.text]);
                if (signal.aborted) return;
                if (!current(choice)) { close(false); return; }
                if (response?.clips?.length === 1 && response.clips[0].status === 'completed') {
                    readiness?.changed(true);
                    play(choice, 'server');
                    return;
                }
                if (response?.clips?.some(clip => clip.status === 'failed')) {
                    readiness?.changed(true);
                    detail.textContent = 'Die Vorbereitung ist fehlgeschlagen. Erneut versuchen oder die Ausgabe wechseln.';
                    return;
                }
                await new Promise(resolve => {
                    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
                    const timer = setTimeout(finish, 1000);
                    signal.addEventListener('abort', finish, { once: true });
                });
            }
        } catch (_) {
            if (!signal.aborted) detail.textContent = 'Serveraudio konnte nicht vorbereitet werden. Bitte erneut versuchen.';
        } finally {
            if (waiting === controller) {
                stopWaiting();
                waitButton.disabled = !canWait(choice.text);
            }
        }
    }
    for (const button of buttons) {
        button.classList.add('announcement-playback-button');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', menu.id);
        button.setAttribute('aria-expanded', 'false');
        readiness?.trackText(button, () => readText() ? [readText()] : [], false, { remote: button === remoteButton });
    }
    localButton.addEventListener('click', () => choose(localButton, false));
    form.addEventListener('submit', event => { event.preventDefault(); choose(remoteButton, true); });
    waitButton.addEventListener('click', () => { void wait(); });
    browserButton.addEventListener('click', () => { if (selected) play(selected, 'browser'); });
    cancelButton.addEventListener('click', () => close());
    menu.addEventListener('cancel', event => { event.preventDefault(); close(); });
    textarea.addEventListener('input', () => {
        close(false);
        readiness?.changed();
        clearTimeout(draftTimer);
        const draftSignature = signature();
        draftTimer = setTimeout(() => {
            const text = readText();
            if (text && textarea.isConnected && signature() === draftSignature) void service.prepare([text]);
        }, 1500);
        updateButtons();
    });
    updateButtons();
}

if (typeof module !== 'undefined' && module.exports) module.exports = createFreeAnnouncementForm;
