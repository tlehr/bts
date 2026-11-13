'use strict';

// Local court slots are released before the external notification. Keep the
// previous court identity so BTP can also release a now-empty slot, without
// clearing a different game that has already taken that court.
function updates(courts, match, previous_court_id) {
	const setup=match.setup || {}, match_id=match.btp_match_ids?.[0]?.id;
	const previous=typeof previous_court_id==='object' ? previous_court_id?._id : previous_court_id;
	const legacy=match.btp_id==null ? null : 'btp_'+match.btp_id;
	const result=[];
	for(const court of courts) {
		if(court.btp_id==null)continue;
		if(setup.now_on_court) {
			if(court._id===setup.court_id&&match_id!=null)result.push({btp_id:court.btp_id,btp_match_id:match_id});
		} else {
			const own=court.match_id===match._id||(legacy!=null&&court.match_id===legacy);
			const released=!court.match_id&&(court._id===previous||court._id===setup.court_id);
			if(own||released)result.push({btp_id:court.btp_id});
		}
	}
	return result;
}

module.exports={updates};
