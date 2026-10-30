(()=>{
 const pairs=['Mia Becker / Finn Sommer','Lena Hoffmann / Noah Weber','Emil Wagner / Sophie Koch','Paul Fischer / Emma Richter','Jonas Klein / Clara Wolf','Ben Neumann / Lea Braun','Tom Keller / Anna Schäfer','Oskar Brandt / Julia Winter','Nina Berg / Lukas König','Theo Lang / Marie Frank','Max Seidel / Sarah Krüger','Erik Roth / Amelie Schubert','Leon Hartmann / Ida Schmitt','Anton Hahn / Luisa Scholz','Jan Lorenz / Maja Seifert','David Peters / Frieda Vogt','Tim Krause / Greta Fuchs'];
 const now=Date.now(),key='preview',ids=new Map();
 const person=(name,checked=true)=>{if(!ids.has(name))ids.set(name,ids.size+1);const parts=name.split(' ');return{btp_id:ids.get(name),name,firstname:parts[0],lastname:parts.slice(1).join(' '),checked_in:checked,check_in_per_match:true};};
 const team=(index,checked=true)=>({players:pairs[index%pairs.length].split(' / ').map(name=>person(name,checked))});
 const numbers=[44,37,40,0,36,32,38,30,43,39,42,41,0];
 const scores=[[[5,5]],[[23,21],[21,11]],[[15,21],[21,18],[21,17]],[],[[19,21],[12,16]],[[21,14],[17,21],[21,14]],[[14,21],[11,14]],[[21,19],[16,21],[21,14]],[[10,9]],[[10,9]],[[19,21],[6,4]],[[0,0]],[]];
 const locations=[{_id:'CH',name:'Campus Hellweg',short_name:'CH',highlight:6},{_id:'SN',name:'Sporthalle Nord',short_name:'SN',highlight:4}];
 const courts=numbers.map((number,index)=>({_id:'CH_'+(index+1),num:String(index+1),location_id:'CH',is_active:true,match_id:number?'match-'+number:null}));
 const matches=numbers.flatMap((number,index)=>number?[{_id:'match-'+number,tournament_key:key,network_score:scores[index],presses:[],shuttle_count:index===4?3:0,setup:{is_match:true,is_doubles:true,state:'oncourt',now_on_court:true,court_id:courts[index]._id,location_id:'CH',match_num:number,scheduled_time_str:number<40?'10:30':'11:00',match_name:number<40?'R16':'VF',event_name:number<40?'MX U19':'MX U15',counting:'3x21',teams:[team(index),team(index+5)],highlight:0,tabletoperators:team(index+9).players,called_timestamp:now-86000}}]:[]);
 matches.find(match=>match._id==='match-41').setup.warmup='call-up';
 for(let index=0;index<9;index++) {
  const number=45+index,prep=[0,1,2,4].includes(index),location=index===1||index===4?'SN':'CH';
  const match={_id:'match-'+number,tournament_key:key,presses:[],setup:{is_match:true,is_doubles:true,state:prep?'preparation':'scheduled',now_on_court:false,match_num:number,scheduled_time_str:'11:00',match_name:index<4?'9/16':'VF',event_name:index<4?'MX U15':'MX U17',counting:'3x21',teams:[team(index+13),team(index+14)],highlight:prep?location==='CH'?6:4:0,location_id:prep?location:undefined,preparation_call_timestamp:prep?now-(289-index*25)*1000:undefined}};
  if(index===0){match.setup.teams[0].players[1]=person('Lara Seidel',false);match.setup.umpire=person('Sven Weber');match.setup.service_judge=person('Kim Wolf',false);}
  if(index===1)match.setup.tabletoperators=[person('Alex Berger',false),person('Sam Neubert',false)];
  if(index===2)match.setup.umpire=person('Toni Meier');
  if(index===4){match.setup.tabletoperators=[person('Robin Schulz',false)];match.setup.preparation_call_deferred=true;}
  if(index===3){match.setup.teams[0].players[0]=person('Lena Hoffmann');match.setup.teams[0].players[0].last_time_on_court_ts=now-30000;}
  if(index===6)match.setup.teams[1].players=[];
  matches.push(match);
 }
 const umpires=[
  {_id:'official-1',btp_id:901,name:'Sven Weber',firstname:'Sven',surname:'Weber',status:'pause',is_umpire:true,is_service_judge:true,umpire_pause:now+90000,umpire_on_court:null,service_judge_on_court:null},
  {_id:'official-2',btp_id:902,name:'Kim Wolf',firstname:'Kim',surname:'Wolf',status:'standby',is_umpire:true,is_service_judge:true,is_planed_as_service_judge:true},
  {_id:'official-3',btp_id:903,name:'Toni Meier',firstname:'Toni',surname:'Meier',status:'oncourt',is_umpire:true,is_service_judge:true,umpire_on_court:'CH_2',court_id:'CH_2'},
  {_id:'official-4',btp_id:904,name:'Anton Anderson',firstname:'Anton',surname:'Anderson',status:'ready',is_umpire:true,is_service_judge:true,umpire_wait:now-60000,umpire_on_court:null,service_judge_on_court:null},
  {_id:'official-5',btp_id:905,name:'Bertha Baller',firstname:'Bertha',surname:'Baller',status:'ready',is_umpire:true,is_service_judge:true,service_judge_wait:now-50000,umpire_on_court:null,service_judge_on_court:null},
  {_id:'official-6',btp_id:906,name:'Hans Heinrich',firstname:'Hans',surname:'Heinrich',status:'pause',is_umpire:true,is_service_judge:true,umpire_manual_pause:now-40000,umpire_on_court:null,service_judge_on_court:null},
 ];
 const displays=[
  {client_id:'21',hostname:'Tablet Feld 1',client_ip:'::ffff:192.168.10.21',court_id:'CH_1',displaysetting_id:'tablet-profile',panel_devicemode:'umpire',online:true,battery:{level:.76,charging:false}},
  {client_id:'22',hostname:'Tablet Feld 2',client_ip:'192.168.10.22',court_id:'CH_2',displaysetting_id:'tablet-profile',panel_devicemode:'umpire',online:true,battery:{level:.25,charging:true}},
  {client_id:'23',hostname:'Tablet Feld 13',client_ip:'192.168.10.23',court_id:'CH_13',displaysetting_id:'tablet-profile',panel_devicemode:'umpire',online:true,battery:{level:.08,charging:false}},
  {client_id:'24',hostname:'Gast-Tablet',court_id:'',displaysetting_id:'tablet-profile',panel_devicemode:'umpire',online:true},
  {client_id:'25',hostname:'Tablet offline',court_id:'CH_3',displaysetting_id:'tablet-profile',panel_devicemode:'umpire',online:false,battery:{level:.55,charging:false}},
  {client_id:'30',hostname:'Anzeige',court_id:'CH_1',displaysetting_id:'display-profile',panel_devicemode:'display',online:true},
 ];
 const displaysettings=[{id:'tablet-profile',devicemode:'umpire',tablet_mode:'umpire'},{id:'display-profile',devicemode:'display'}];
 const fixture={key,name:'Jugend-Rangliste 2026',language:'de',btp_enabled:false,btp_settings:{check_in_per_match:true,pause_duration_ms:120000},automation_enabled:true,call_preparation_matches_automatically_enabled:true,call_next_possible_scheduled_match_in_preparation:true,tabletoperator_enabled:true,tabletoperator_split_doubles:false,official_rotation_mode:'umpire_and_service_judge',locations,courts,matches,umpires,displays,displaysettings,events:{events:[]},normalizations:[],scoring_formats:[],tabletoperators:[{_id:'tablet-1',tabletoperator:team(6).players,played_on_court:'CH_13',start_ts:1},{_id:'tablet-2',tabletoperator:team(14).players,played_on_court:'CH_4',start_ts:2}],status:{status:'connected',message:''},btp_status:{status:'deactivated',message:''},ticker_status:{status:'deactivated',message:''}};
 window.__writes=[];
 window.__speechFixture={status:'completed',settings:{enabled:true,key,mode:'auto',voice:'hallensprecherin',language:'de-DE',audio_ready:true,max_text:1200}};
 window.__localAnnouncements=[];window.__speechPrepared=[];
 window.btsSpeechService={
  settings:()=>({...window.__speechFixture.settings}),ensureAudio:async()=>{},
  prepare:async parts=>{window.__speechPrepared.push([...parts]);},
  inspect:async parts=>({speech:{enabled:true,cache_version:'fixture'},clips:parts.map(()=>({status:window.__speechFixture.status,local:true}))}),
  speak:async(parts,_id,_browser,_localParts,_pauses,_plan,speechMode)=>{window.__localAnnouncements.push({parts:[...parts],speechMode});return{status:'ok',provider:speechMode==='browser'?'browser':'server',started:true};},
  describeResult:()=> 'Serveraudio bereit',outputMessage:()=> 'Serveraudio bereit · Queue leer',
 };
 window.btsSpeechReadiness=createSpeechReadiness({
  createTexts:createAnnouncementTexts,translate:(...args)=>ci18n(...args),service:window.btsSpeechService,
  snapshot:()=>({tournament:typeof curt==='undefined'?null:curt,settings:window.btsSpeechService.settings()}),
  visible:()=>true,schedule:(callback,ms)=>setTimeout(callback,ms),
 });
 window.btsSpeechReadiness.trackMatch=()=>{};
 window.send=(message,callback)=>{
  if(message.type==='tournament_get')return setTimeout(()=>callback?.(null,{tournament:structuredClone(fixture)}),0);
  if(message.type==='preparation_selection_get')return setTimeout(()=>callback?.(null,{selections:[{location_id:'CH',demand_court_ids:['CH_4','CH_5','CH_7','CH_13'],current_preparation_count:2,required_preparation_count:4,missing_preparation_count:2,diagnostics_by_match_id:{},call_on_court_diagnostics_by_match_id:{}}]}),0);
  window.__writes.push(structuredClone(message));if(callback)setTimeout(()=>callback(null,{}),0);
 };
 ci18n.init();ci18n.switch_language('de');crouting.init();
})()
