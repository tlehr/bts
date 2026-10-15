'use strict';

const create = require('../../static/js/announcement_text');
const { _translate: translate } = require('../../static/js/ci18n');

const CALLS = [
    'announceNewMatch', 'announcePreparationMatch',
    'announceSecondCallTeamOne', 'announceSecondCallTeamTwo',
    'announceSecondPreparationCallTeamOne', 'announceSecondPreparationCallTeamTwo',
    'announceSecondCallTabletoperator', 'announceSecondCallUmpire', 'announceSecondCallServiceJudge',
    'announceSecondPreparationCallTabletoperator', 'announceSecondPreparationCallUmpire',
    'announceSecondPreparationCallServiceJudge', 'announceBeginnToPlay',
];

function renderer(tournament, locale, parts) {
    return create({
        tournament,
        translate: (key, data, fallback) => translate(locale, key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } },
        claim: () => null,
        announce: values => parts.push(...values.filter(value => typeof value === 'string' && value.length)),
    });
}

function prepare(tournament, matches, locale = 'de') {
    const parts = [translate(locale, 'announcements:speechcheck:text')];
    const texts = renderer(tournament, locale, parts);
    for (const court of tournament.courts || []) {
        if (court.is_active === false) continue;
        parts.push(texts.createFieldAnnouncement({ court_id: court._id }));
        parts.push(texts.createFieldPreparationAnnouncement({ court_id: court._id }));
        parts.push(texts.createBeginToPlayAnnouncement({ court_id: court._id }));
    }
    for (const match of matches) {
        const setup = match.setup;
        if (!setup || !setup.teams?.[0]?.players?.length || !setup.teams?.[1]?.players?.length) continue;
        for (const builder of ['createTeamAnnouncement', 'createEventAnnouncement', 'createRoundAnnouncement',
            'createMatchNumberAnnouncement', 'createUmpire', 'createServiceJudge', 'createTabletOperator',
            'createPreparationAnnouncement', 'createMeetingPointAnnouncement']) {
            try { parts.push(texts[builder](setup)); } catch (_) { /* Still-unknown fields do not block known parts. */ }
        }
        for (const call of CALLS) {
            try { texts[call](setup); } catch (_) { /* Unknown future officials remain unprepared. */ }
        }
        // Preparation location is sometimes assigned only at the actual call.
        if (!setup.location_id) {
            for (const location of tournament.locations || []) {
                texts.announcePreparationMatch({ ...setup, location_id: location._id });
                for (const call of ['announceSecondPreparationCallTeamOne', 'announceSecondPreparationCallTeamTwo']) {
                    texts[call]({ ...setup, location_id: location._id });
                }
            }
        }
    }
    return [...new Set(parts.filter(Boolean))];
}

module.exports = { prepare, renderer, CALLS };
