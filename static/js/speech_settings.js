/* exported resolveSpeechSettings */
'use strict';

function resolveSpeechSettings(tournament = {}, defaults = tournament.speech || {}) {
    const choose = (values, value, fallback, otherwise) => values.includes(value) ? value :
        values.includes(fallback) ? fallback : otherwise;
    return {
        mode: choose(['browser', 'auto', 'server'], tournament.announcement_speech_mode, defaults.mode, 'browser'),
        voice: choose(['hallensprecherin', 'hallensprecher'], tournament.announcement_speech_voice, defaults.voice, 'hallensprecherin'),
        warm_other_voice: tournament.announcement_speech_warm_other_voice === true,
    };
}

resolveSpeechSettings.valid = props =>
    (!Object.hasOwn(props, 'announcement_speech_mode') || ['browser', 'auto', 'server'].includes(props.announcement_speech_mode)) &&
    (!Object.hasOwn(props, 'announcement_speech_voice') || ['hallensprecherin', 'hallensprecher'].includes(props.announcement_speech_voice)) &&
    (!Object.hasOwn(props, 'announcement_speech_warm_other_voice') || typeof props.announcement_speech_warm_other_voice === 'boolean');

if (typeof module !== 'undefined' && module.exports) module.exports = resolveSpeechSettings;
