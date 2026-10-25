'use strict';
(function() {
    const match = /^\/admin\/t\/([^/]+)\/speech-helpers\/?$/.exec(location.pathname);
    if (!match) return;
    const key = decodeURIComponent(match[1]), $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
    const labels = { queued: 'Wartet auf Helfer', processing: 'Wird erzeugt', completed: 'Bereit', failed: 'Fehlgeschlagen', validating: 'Zentrale Prüfung' };
    const messages = { helper_runtime_missing: 'Das Laufzeitpaket ist auf dem BTS noch nicht vorbereitet.', helper_runtime_invalid: 'Das Laufzeitpaket ist unvollständig.',
        helper_process_required: 'Der isolierte Sprachprozess ist noch nicht verfügbar.', helper_address_not_reachable: 'Bitte eine vom Helfer-Rechner erreichbare Netzwerkadresse verwenden; localhost bezeichnet dort den Helfer-Rechner.',
        helper_platform_invalid: 'Dieses Starterformat wird nicht unterstützt.', helper_launcher_invalid: 'Der Windows-Starter ist auf dem BTS nicht vollständig vorbereitet.',
        helper_update_required: 'Bitte den alten Helfer stoppen und einen neuen Starter herunterladen.', helper_plan_changed: 'Der Vorbereitungsplan hat sich geändert.',
        helper_assignment_lost: 'Die Reservierung beim Sprachserver ist nicht mehr vorhanden.', helper_memory_limit: 'Das freigegebene Modell-RAM hat nicht gereicht.',
        helper_pair_limit: 'Zu viele noch gültige Starter. Bitte später erneut versuchen.', helper_lease_lost: 'Auftrag wurde inzwischen neu vergeben.' };
    let socket, serial = 0, busy = false, downloading = false, stopped = false, loaded = false, origin, snapshot, lastAction = 0;
    const downloadButtons = [$('download'), $('download-linux')];
    const pending = new Map(), jobs = new Map();
    $('back').href = '/admin/t/' + encodeURIComponent(key) + '/edit';
    function error(message) { $('error').hidden = !message; $('error').textContent = messages[message] || message; }
    function request(type, fields = {}) {
        return new Promise((resolve, reject) => {
            const rid = ++serial, timer = setTimeout(() => { pending.delete(rid); reject(new Error('Anfrage nicht rechtzeitig beantwortet')); }, 10000);
            pending.set(rid, { resolve, reject, timer }); socket.send(JSON.stringify({ type, tournament_key: key, rid, ...fields }));
        });
    }
    async function helperRequest(type, fields) {
        const delay = Math.max(0, lastAction + 300 - Date.now()); lastAction = Date.now() + delay;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        const result = await request(type, fields);
        if (result.speech_error) throw new Error(result.speech_error);
        return result;
    }
    function render(response) {
        snapshot = response.helpers;
        const endpoint = response.speech?.audio_endpoint;
        if (endpoint) {
            origin = endpoint.origin || endpoint.protocol + '//' + location.hostname + ':' + endpoint.port;
            if (!$('endpoint').value) $('endpoint').value = origin;
        }
        for (const button of downloadButtons) button.disabled = downloading || !snapshot?.runtime;
        $('test').disabled = !snapshot?.workers.some(w => w.online && !w.paused && !w.revoked && !w.update_required);
        $('runtime').textContent = snapshot?.runtime ? ' Laufzeit: ' + (snapshot.runtime.size_bytes / 1024 ** 3).toFixed(1) + ' GiB, einmaliger Download' : messages[snapshot?.error] || ' Laufzeit nicht verfügbar';
        $('connection').textContent = 'Verbunden · ' + (snapshot.generation?.ready ? 'Reguläre Aufträge werden automatisch verteilt' :
            snapshot.generation?.reason === 'helper_profile_mismatch' ? 'Helferpaket passt nicht zum Sprachserver – Paket auf BTS neu erstellen und Starter erneut herunterladen' :
                'Warte auf den bereiten Sprachserver für reguläre Aufträge');
        $('empty').hidden = snapshot.workers.length > 0;
        $('workers').innerHTML = snapshot.workers.map(worker => `<tr><td><strong>${esc(worker.name)}</strong><small>${esc(worker.platform)} · ${worker.threads} CPU-Kerne · ${((worker.memory_limit_mib ?? 3584) / 1024).toLocaleString('de-DE')} GiB Modell-RAM-Abbruchgrenze</small></td>
            <td><span class="status ${worker.job_id ? 'working' : worker.online ? 'online' : ''}">${worker.revoked ? 'Zugang entzogen' : !worker.online ? 'Nicht verbunden' : worker.update_required ? 'Neuen Starter herunterladen' : worker.job_id ? 'Arbeitet' : worker.paused ? 'Pausiert' : 'Bereit'}</span></td>
            <td>${worker.job_id ? esc(worker.text || worker.job_id.slice(0, 8)) : '–'}</td><td>${worker.completed}</td><td>${worker.revoked ? '' :
                `<button data-test="${esc(worker.id)}" ${worker.online && !worker.paused && !worker.update_required ? '' : 'disabled'}>Testaufnahme</button><button data-control="${worker.paused ? 'resume' : 'pause'}" data-id="${esc(worker.id)}">${worker.paused ? 'Fortsetzen' : 'Pause'}</button><button data-control="revoke" data-id="${esc(worker.id)}">Trennen</button>`}</td></tr>`).join('');
        const live = new Set();
        for (const job of snapshot.jobs) {
            live.add(job.id);
            let node = jobs.get(job.id);
            if (!node) { node = document.createElement('article'); node.className = 'job'; jobs.set(job.id, node); $('jobs').appendChild(node); }
            const worker = snapshot.workers.find(row => row.id === job.worker_id);
            const signature = JSON.stringify([job.state, job.worker_id, job.attempt, job.error, job.elapsed_ms, job.publication]);
            if (node.dataset.signature !== signature) {
                node.innerHTML = `<strong>${esc(job.kind === 'source' && job.state === 'completed' ? job.publication === 'ready' ? 'Bereit' : job.publication === 'failed' ? 'Nicht übernommen' : job.publication === 'checking' ? 'Zentrale Prüfung eingeplant' : 'Wartet auf zentrale Prüfung' : labels[job.state] || job.state)}</strong> · ${job.kind === 'source' ? 'Kontextaufnahme' : 'Testaufnahme'} · ${esc(job.voice)} ${worker ? '· ' + esc(worker.name) : ''}
                    <small>${new Date(job.created_at).toLocaleString('de-DE')}${job.elapsed_ms ? ' · ' + (job.elapsed_ms / 1000).toFixed(1) + ' Sekunden' : ''} · Versuch ${job.attempt || 0}</small><p>${esc(job.text)}</p>
                    ${job.error ? `<p class="failed">${esc(messages[job.error] || job.error)}</p>` : ''}${job.audio_path ? '<audio controls preload="none"></audio>' : ''}`;
                node.dataset.signature = signature;
            }
            const audio = node.querySelector('audio');
            if (audio && audio.paused && (!audio.src || Number(audio.dataset.expires) < Date.now() / 1000 + 30)) {
                audio.src = origin + job.audio_path;
                audio.dataset.expires = new URL(audio.src).searchParams.get('expires');
            }
        }
        for (const [id, node] of jobs) if (!live.has(id)) { node.remove(); jobs.delete(id); }
    }
    async function refresh() {
        if (busy || !loaded || socket?.readyState !== 1) return;
        busy = true;
        try { render(await helperRequest('speech_helpers')); error(''); }
        catch (failure) { error(failure.message); }
        finally { busy = false; }
    }
    async function action(type, fields) {
        try { await helperRequest(type, fields); await refresh(); }
        catch (failure) { error(failure.message); }
    }
    async function download(platform) {
        if (downloading) return;
        downloading = true;
        for (const button of downloadButtons) button.disabled = true;
        try {
            const response = await helperRequest('speech_helper_bundle', { endpoint: $('endpoint').value.trim(), platform });
            const bundle = response.bundle, bytes = Uint8Array.from(atob(bundle.content_base64), c => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: bundle.mime_type }));
            const link = document.createElement('a'); link.href = url; link.download = bundle.filename; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000); error('');
        } catch (failure) { error(failure.message); }
        finally { downloading = false; for (const button of downloadButtons) button.disabled = !loaded || !snapshot?.runtime; }
    }
    $('download').onclick = () => download('windows');
    $('download-linux').onclick = () => download('linux');
    $('test').onclick = () => action('speech_helper_test', { voice: $('voice').value });
    $('workers').onclick = event => {
        const test = event.target.closest('[data-test]');
        if (test) return void action('speech_helper_test', { voice: $('voice').value, worker_id: test.dataset.test });
        const control = event.target.closest('[data-control]');
        if (control) void action('speech_helper_control', { worker_id: control.dataset.id, action: control.dataset.control });
    };
    function connect() {
        if (stopped) return;
        socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/admin');
        socket.onopen = async () => {
            try {
                await request('tournament_get', { key, defer_finished_history: true });
                await request('speech_health_subscribe').catch(() => {});
                loaded = true; await refresh();
            }
            catch (failure) { error(failure.message); }
        };
        socket.onmessage = event => {
            const response = JSON.parse(event.data);
            if (response.type === 'speech_health') { window.btsSpeechHealth?.update(response.health); return; }
            const entry = pending.get(response.rid);
            if (!entry) return; pending.delete(response.rid); clearTimeout(entry.timer);
            response.type === 'error' ? entry.reject(new Error(response.message)) : entry.resolve(response);
        };
        socket.onclose = () => {
            loaded = false; busy = false; $('connection').textContent = 'Verbindung unterbrochen · angezeigter Stand ist veraltet';
            window.btsSpeechHealth?.disconnected();
            for (const button of downloadButtons) button.disabled = true;
            $('test').disabled = true;
            for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Verbindung unterbrochen')); } pending.clear();
            if (!stopped) setTimeout(connect, 3000);
        };
        socket.onerror = () => socket.close();
    }
    const poll = setInterval(refresh, 2000);
    addEventListener('pagehide', () => { stopped = true; clearInterval(poll); socket?.close(); });
    connect();
}());
