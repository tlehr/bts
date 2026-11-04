/* global ci18n */
'use strict';

var btsDurationInput = (() => {
    const scales = {milliseconds: 1, seconds: 1000, minutes: 60000};
    function format(value, {unit = 'seconds'} = {}) {
        if (value == null || value === '') return '';
        const ms = Math.round(Number(value) * scales[unit]);
        if (!Number.isFinite(ms)) return '';
        const absolute = Math.abs(ms), seconds = Math.floor(absolute / 1000) % 60;
        const fraction = absolute % 1000;
        return (ms < 0 ? '-' : '') + Math.floor(absolute / 60000) + ':' + String(seconds).padStart(2, '0') +
            (fraction ? ',' + String(fraction).padStart(3, '0').replace(/0+$/, '') : '');
    }
    function parse(value, {unit = 'seconds', signed = false, nullable = false} = {}) {
        const text = String(value ?? '').trim();
        if (!text && nullable) return null;
        const match = /^(-?)(\d+):([0-5]?\d)(?:[,.](\d{1,3}))?$/.exec(text);
        if (!match || (match[1] && !signed)) return NaN;
        const ms = (Number(match[2]) * 60000 + Number(match[3]) * 1000 + Number((match[4] || '').padEnd(3, '0'))) * (match[1] ? -1 : 1);
        return Number.isSafeInteger(ms) ? ms / scales[unit] : NaN;
    }
    function attach(input, {unit = 'seconds', value = 0, min = 0, max = null, signed = false, nullable = false} = {}) {
        const options = {unit, signed, nullable};
        input.type = 'text';
        for (const attr of ['min', 'max', 'step']) input.removeAttribute(attr);
        input.classList.add('duration-input');
        input.autocomplete = 'off';input.spellcheck = false;input.placeholder = '0:00';
        input.dataset.durationUnit = unit;
        const translate = (key, data) => typeof ci18n === 'function' ? ci18n('settings:duration:' + key, data) : key;
        const label = translate('minutes');
        const parent = input.parentElement;
        let suffix = parent.querySelector('.settings-field-unit');
        if (!suffix) {
            if (!parent.classList.contains('settings-row-control')) {
                const wrapper = input.ownerDocument.createElement('span');wrapper.className = 'duration-input-wrap';
                input.before(wrapper);wrapper.append(input);
            } else parent.classList.add('has-unit');
            suffix = input.ownerDocument.createElement('span');suffix.className = 'settings-field-unit duration-input-unit';
            input.after(suffix);
            suffix.id = (input.id || input.name) + '-duration-unit';
            input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), suffix.id].filter(Boolean).join(' '));
        }
        suffix.textContent = label;
        input.title = translate('format') + ' ' + translate('editing');
        const read = () => parse(input.value, options);
        function segments() {
            const colon = input.value.indexOf(':');
            if (colon < 0) return [];
            const decimal = input.value.search(/[,.]/);
            return [
                {name:'minutes', start:0, end:colon},
                {name:'seconds', start:colon + 1, end:decimal < 0 ? input.value.length : decimal},
                ...(decimal < 0 ? [] : [{name:'fraction', start:decimal + 1, end:input.value.length}]),
            ];
        }
        function currentSegment() {
            const parts = segments(), position = input.selectionStart ?? 0;
            return parts.find(part => position <= part.end) || parts.at(-1);
        }
        function selectSegment(name) {
            const parts = segments(), part = parts.find(item => item.name === name) || parts.at(-1);
            if (part) input.setSelectionRange(part.start, part.end);
        }
        function validate() {
            const number = read();
            const error = number === null ? '' : !Number.isFinite(number) ? translate('invalid') :
                min != null && number < min ? translate('min', {value: format(min, options)}) :
                    max != null && number > max ? translate('max', {value: format(max, options)}) : '';
            input.setCustomValidity(error);
            if (error) input.setAttribute('aria-invalid', 'true');else input.removeAttribute('aria-invalid');
            return !error;
        }
        function write(number) {
            const selected = input.ownerDocument?.activeElement === input && segments().find(part =>
                part.start !== part.end && input.selectionStart === part.start && input.selectionEnd === part.end);
            input.value = format(number, options);validate();
            if (selected) selectSegment(selected.name);
        }
        const restore = number => write(number == null || number === '' || !Number.isFinite(Number(number)) ? value : number);
        const control = input.btsDuration = {read, write, restore, validate, format: number => format(number, options), initial: value};
        const emitChange = () => {
            const Event = input.ownerDocument.defaultView.Event;
            input.dispatchEvent(new Event('input', {bubbles: true}));input.dispatchEvent(new Event('change', {bubbles: true}));
        };
        function step(direction, minutes = false) {
            if (input.disabled || input.readOnly || input.matches(':disabled')) return false;
            const number = read();if (number === null || !Number.isFinite(number)) return false;
            const part = currentSegment(), name = minutes ? 'minutes' : part?.name || 'minutes';
            const milliseconds = name === 'minutes' ? 60000 : name === 'fraction' ?
                10 ** (3 - (part.end - part.start)) : 1000;
            const amount = milliseconds / scales[unit];
            const next = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, number + direction * amount));
            write(next);selectSegment(name);emitChange();return true;
        }
        btsNumberInput.createStepper(input, {change:step, labels:[translate('increase'), translate('decrease')]});
        let pointerFocus = false, pointerStart = null;
        const resetPointer = () => {pointerFocus = false;pointerStart = null;};
        input.addEventListener('pointerdown', event => {
            pointerFocus = true;pointerStart = {x:event.clientX,y:event.clientY};
            // Clear an old highlight before the browser starts a possible text
            // drag; otherwise Chrome collapses it after our click handler.
            if (event.button === 0 && !event.shiftKey && input.selectionStart !== input.selectionEnd) {
                input.setSelectionRange(input.selectionStart, input.selectionStart);
            }
        });
        input.addEventListener('blur', resetPointer);
        input.addEventListener('pointercancel', resetPointer);
        input.addEventListener('focus', () => {
            // A pointer must first place the caret where the user clicked.
            // Keyboard focus starts in the minutes part instead.
            if (!pointerFocus) selectSegment('minutes');
            pointerFocus = false;
        });
        input.addEventListener('click', event => {
            const dragged = pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 3;
            resetPointer();
            // Keep deliberate drag selections and Select All available for copying
            // or replacing the complete duration.
            if (event.button !== 0 || event.shiftKey || event.detail > 1 || dragged) return;
            const part = currentSegment();if (part) selectSegment(part.name);
        });
        input.addEventListener('beforeinput', event => {
            if (event.isComposing || event.inputType !== 'insertText' || input.disabled || input.readOnly) return;
            if (event.data === ':' && input.value.includes(':')) {
                event.preventDefault();selectSegment('seconds');
            } else if (/^\d+$/.test(event.data || '') &&
                (!input.value || (input.selectionStart === 0 && input.selectionEnd === input.value.length))) {
                // Start a complete replacement in the minutes part; typing the
                // colon afterwards moves to seconds rather than adding a second colon.
                event.preventDefault();input.value = event.data + ':00';
                input.setSelectionRange(event.data.length, event.data.length);
                const Event = input.ownerDocument.defaultView.Event;
                input.dispatchEvent(new Event('input', {bubbles:true}));
            }
        });
        input.addEventListener('input', validate);
        input.addEventListener('change', () => { if (validate()) write(read()); });
        input.addEventListener('keydown', event => {
            if (event.altKey || event.ctrlKey || event.metaKey || input.disabled || input.readOnly || event.isComposing) return;
            const part = currentSegment();
            if (part && !event.shiftKey && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const parts = segments(), index = parts.findIndex(item => item.name === part.name);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? parts.length - 1 :
                    Math.max(0, Math.min(parts.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
                selectSegment(parts[next].name);return;
            }
            if (event.key === 'Enter' && !input.form) {
                event.preventDefault();
                if (!validate()) {input.reportValidity();return;}
                write(read());if (part) selectSegment(part.name);emitChange();return;
            }
            if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            if (step(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)) event.preventDefault();
        });
        write(value);
        return control;
    }
    return {attach, parse, format};
})();

if (typeof module !== 'undefined' && module.exports) {
    var btsNumberInput = require('./number_input');
    module.exports = btsDurationInput;
}
