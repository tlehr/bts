'use strict';

// Panel reads need presentation/settings fields, never the registration package.
// Use an inclusion projection: NeDB clones documents before applying exclusions.
module.exports = {
	key: 1, name: 1, language: 1,
	logo_id: 1, logo_background_color: 1, logo_foreground_color: 1,
	displaysettings_general: 1, displaysettings_general_tablet: 1,
	bupws_v2_enabled: 1, bup_v2_admin_wait_for_score_updates: 1,
	bts_debug_output_enabled: 1, bts_server_diagnostics_enabled: 1, bts_auto_call_trace_enabled: 1, bts_score_press_timing_enabled: 1,
};
