/* eslint-env browser */
/* global ci18n */
'use strict';

// This notice belongs to the browser session, so changing an admin tab must
// neither recreate the audio player nor interrupt an announcement.
(() => {
    let notice, title, description, button, pending = false, retry = false;
    const service = () => window.btsSpeechService;
    const position = () => {
        if (notice) notice.style.top = ((document.querySelector('.toprow')?.offsetHeight || 0) + 12) + 'px';
    };
    function create() {
        notice = document.createElement('aside');
        notice.className = 'audio-activation';
        notice.setAttribute('aria-labelledby', 'audio-activation-title');
        const text = document.createElement('div');
        text.setAttribute('role', 'status');
        title = document.createElement('strong');
        title.id = 'audio-activation-title';
        description = document.createElement('p');
        text.append(title, description);
        button = document.createElement('button');
        button.type = 'button';
        button.addEventListener('click', activate);
        notice.append(text, button);
        document.body.append(notice);
        if (window.ResizeObserver) new ResizeObserver(position).observe(document.querySelector('.toprow'));
        window.addEventListener('resize', position);
        position();
    }
    function update() {
        const value = service()?.settings();
        const blocked = !!value?.key && !value.audio_ready && value.audio_error === 'audio_blocked';
        if (!blocked) retry = false;
        if (!notice && !blocked) return;
        if (!notice) create();
        notice.hidden = !blocked;
        title.textContent = ci18n('audio:activation:title');
        description.textContent = ci18n(retry ? 'audio:activation:retry' : 'audio:activation:description');
        button.textContent = ci18n(pending ? 'audio:activation:pending' : 'audio:activation:button');
        button.disabled = pending;
        notice.setAttribute('aria-busy', String(pending));
    }
    function activate() {
        if (pending) return;
        pending = true;
        update();
        // Start inside the click handler, before any await/network request:
        // browsers use this trusted user gesture to release autoplay blocking.
        let attempt;
        try { attempt = service().unlock(); }
        catch (_) { attempt = Promise.resolve(false); }
        void Promise.resolve(attempt).catch(() => false).then(ready => {
            pending = false;
            retry = !ready;
            update();
        });
    }
    window.addEventListener('bts-speech-output-changed', update);
})();
