/* global ci18n */
/* exported btsNumberInput */
'use strict';

var btsNumberInput = (() => {
    const text = key => typeof ci18n === 'function' ? ci18n('settings:number:' + key) : key;
    const blocked = input => input.disabled || input.readOnly || input.matches(':disabled');
    function createStepper(input, {change, labels, allowed = () => true, prefix = 'duration-input'}) {
        const doc = input.ownerDocument, element = doc.createElement('span');element.className = prefix + '-stepper';
        const buttons = [1, -1].map((direction, index) => {
            const button = doc.createElement('button');button.type = 'button';button.tabIndex = -1;
            button.className = prefix + (direction > 0 ? '-increase' : '-decrease');
            button.setAttribute('data-step', direction > 0 ? 'up' : 'down');
            button.title = labels[index];button.setAttribute('aria-label', button.title);
            button.addEventListener('pointerdown', event => {if (event.button === 0) event.preventDefault();});
            button.addEventListener('click', event => {
                event.preventDefault();if (blocked(input) || !allowed()) return;
                input.focus();change(direction, event.shiftKey);
            });
            element.append(button);return button;
        });
        const sync = () => {for (const button of buttons) {
            const disabled = !!blocked(input);if (button.disabled !== disabled) button.disabled = disabled;
        }};
        sync();new doc.defaultView.MutationObserver(sync).observe(input, {attributes:true, attributeFilter:['disabled', 'readonly']});
        input.after(element);return {element, sync};
    }
    function attach(input, {increment, container, allowed = () => true} = {}) {
        if (input.btsNumber) return input.btsNumber;
        if (input.type !== 'number') return null;
        const doc = input.ownerDocument, wrap = container || doc.createElement('span');
        wrap.classList.add('number-input-wrap');
        if (!container) {input.before(wrap);wrap.append(input);}
        input.classList.add('number-input');input.inputMode = Number.isInteger(Number(input.step || 1)) ? 'numeric' : 'decimal';
        function step(direction, coarse = false) {
            if (blocked(input) || !allowed()) return false;
            const before = input.value, precision = input.step === 'any' ? null : Number(input.step || 1);
            const amount = (increment || precision || 1) * (coarse ? 10 : 1);
            const count = precision && amount / precision;
            if (count && Math.abs(count - Math.round(count)) < 1e-7) {
                if (direction > 0) input.stepUp(Math.round(count));else input.stepDown(Math.round(count));
            } else {
                const min = input.min === '' ? -Infinity : Number(input.min), max = input.max === '' ? Infinity : Number(input.max);
                const value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
                input.value = String(Math.max(min, Math.min(max, Number((value + direction * amount).toPrecision(15)))));
            }
            if (input.value === before) return false;
            const Event = doc.defaultView.Event;
            input.dispatchEvent(new Event('input', {bubbles:true}));input.dispatchEvent(new Event('change', {bubbles:true}));
            return true;
        }
        const arrows = createStepper(input, {change:step, labels:[text('increase'), text('decrease')], allowed, prefix:'number-input'});
        if (!input.title) input.title = text('editing');
        input.addEventListener('keydown', event => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || blocked(input)) return;
            if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();step(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
            }
        });
        return input.btsNumber = {step, wrap, sync:arrows.sync};
    }
    function observe(root) {
        function enhance(node) {
            if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
            if (node.matches?.('input[type="number"]')) attach(node)?.sync();
            for (const input of node.querySelectorAll('input[type="number"]')) attach(input)?.sync();
        }
        enhance(root);
        const observer = new (root.ownerDocument || root).defaultView.MutationObserver(records => {
            for (const record of records) {
                if (record.type === 'attributes') enhance(record.target);
                else for (const node of record.addedNodes) enhance(node);
            }
        });
        observer.observe(root, {subtree:true, childList:true, attributes:true, attributeFilter:['type', 'disabled', 'readonly']});
        return observer;
    }
    return {attach, createStepper, observe};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = btsNumberInput;
else document.addEventListener('DOMContentLoaded', () => btsNumberInput.observe(document.body));
