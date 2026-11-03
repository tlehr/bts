'use strict';
const fs = require('fs'), path = require('path');

module.exports = async function({c, check, click, open, metrics, previews, key, capture}) {
    const checks = [];
    const verify = async (name, expression) => {
        try { await check(name, expression); checks.push(name); }
        catch (error) {
            // eslint-disable-next-line no-console
            console.error(await c.evaluate('({settings:btsSpeechService.settings(),plays:__activationPlays,before:window.__activationBefore,hold:window.__activationHold,button:document.querySelector(".audio-activation button")?.outerHTML,notice:document.querySelector(".audio-activation")?.outerHTML,focus:document.activeElement?.outerHTML,errors:__activationErrors})'));
            throw error;
        }
    };
    const settle = expression => c.evaluate(`(async()=>{for(let i=0;i<100;i++){if(${expression})return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Audio activation did not settle');})()`);
    await open(1440, 900);
    await c.call('Emulation.setFocusEmulationEnabled', {enabled: true});
    await c.evaluate(`(()=>{
        window.__activationErrors=[];window.addEventListener('error',event=>__activationErrors.push(event.message));
        window.__activationDocument=document;window.__activationPlays=0;window.__activationRequests=[];
        window.__activationSettings={enabled:false,key:'preview',mode:'browser',language:'de-DE'};
        window.__activationPlayer=new Audio();window.__activationContext=new AudioContext();
        window.__activationNativePlay=__activationPlayer.play.bind(__activationPlayer);
        window.__activationFail=null;
        __activationPlayer.play=()=>{
            __activationPlays++;
            if(__activationFail)return Promise.reject(Object.assign(new Error(__activationFail),{name:__activationFail}));
            if(window.__activationHold)return new Promise(resolve=>{window.__activationRelease=resolve;});
            return __activationNativePlay();
        };
        window.__activationService=()=>{
            window.btsSpeechService=createSpeechService({
                settings:()=>__activationSettings,makeAudio:()=>__activationPlayer,makeAudioContext:()=>__activationContext,
                request:async(type,values)=>{__activationRequests.push({type,values});return{clips:[]};},
                onStateChange:()=>window.dispatchEvent(new CustomEvent('bts-speech-output-changed')),
            });
        };
        __activationService();
    })()`);
    await verify('No permission notice appears before playback has actually been checked', '!document.querySelector(\'.audio-activation\')');
    await c.evaluate('btsSpeechService.checkAudio()');
    await verify('Chrome autoplay blocking on first arrival shows a clear audio activation request', 'btsSpeechService.settings().audio_error===\'audio_blocked\'&&!document.querySelector(\'.audio-activation\').hidden&&document.querySelector(\'.audio-activation button\').textContent===\'Ton aktivieren\'');
    await verify('The initial permission check generates no announcement, server request or remote output', '__activationPlays===1&&__activationRequests.length===0&&__localAnnouncements.length===0&&!__writes.some(message=>message.type===\'free_announce\')');
    await verify('The request is accessible and does not steal focus or open a modal dialog', 'document.querySelector(\'.audio-activation\').getAttribute(\'aria-labelledby\')===document.querySelector(\'.audio-activation strong\').id&&document.querySelector(\'.audio-activation [role="status"]\')&&!document.querySelector(\'dialog[open]\')&&document.activeElement!==document.querySelector(\'.audio-activation button\')');
    await c.evaluate('window.__activationNotice=document.querySelector(\'.audio-activation\')');
    await click('.leitstand-nav a[href$="/edit"]');
    await verify('A blocked browser keeps the same activation request when navigating to settings', 'document===__activationDocument&&document.querySelector(\'.page-settings\')&&document.querySelector(\'.audio-activation\')===__activationNotice&&!__activationNotice.hidden&&__localAnnouncements.length===0');
    await click('.leitstand-nav a[href$="/certificates"]');
    await verify('The activation request also remains available in the certificates workspace', 'document===__activationDocument&&document.querySelector(\'.page-certificates\')&&document.querySelector(\'.audio-activation\')===__activationNotice&&!__activationNotice.hidden');
    await metrics(390, 700);
    await verify('The permission request fits a narrow screen below the current navigation header', '(()=>{const r=__activationNotice.getBoundingClientRect(),header=document.querySelector(\'.toprow\').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=header.bottom&&r.bottom<innerHeight&&document.querySelector(\'.audio-activation button\').getBoundingClientRect().width>100;})()');
    await capture('audiofreigabe-mobil');
    await metrics(1440, 900);
    await capture('audiofreigabe');
    await c.evaluate('window.__activationBefore=__activationPlays');
    const point = await c.evaluate('(()=>{const r=document.querySelector(\'.audio-activation button\').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
    for (const type of ['mousePressed', 'mouseReleased']) await c.call('Input.dispatchMouseEvent', {type, ...point, button:'left', clickCount:1});
    await settle('btsSpeechService.settings().audio_ready&&__activationNotice.hidden');
    await verify('A real Chrome mouse click enables unmuted playback and removes the request', 'btsSpeechService.settings().audio_ready&&!btsSpeechService.settings().audio_error&&__activationNotice.hidden&&__activationPlayer.volume===1&&__activationContext.state===\'running\'');
    await verify('Capture and button handlers share one probe instead of starting duplicate playback', '__activationPlays===__activationBefore+1&&__activationRequests.length===0&&__localAnnouncements.length===0');
    await c.evaluate('__activationService();btsSpeechService.checkAudio()');
    await verify('A browser that already allows playback needs no further activation request', 'btsSpeechService.settings().audio_ready&&__activationNotice.hidden');

    await c.evaluate('__activationFail=\'NotAllowedError\';__activationService();btsSpeechService.checkAudio()');
    await verify('A later browser rejection shows the existing request again', '!__activationNotice.hidden&&btsSpeechService.settings().audio_error===\'audio_blocked\'');
    await click('.audio-activation button');
    await verify('Persistent browser denial leaves an actionable retry with website settings guidance', '!__activationNotice.hidden&&!document.querySelector(\'.audio-activation button\').disabled&&document.querySelector(\'.audio-activation p\').textContent.includes(\'Autoplay-Einstellungen\')&&__activationRequests.length===0');
    await c.evaluate('__activationFail=null;window.__activationHold=true;window.__activationBefore=__activationPlays;document.querySelector(\'.audio-activation button\').focus()');
    await key('Enter', 'Enter', 13, '\r');
    await verify('Keyboard activation starts the permission check and prevents repeated submission while pending', 'document.querySelector(\'.audio-activation button\').disabled&&document.querySelector(\'.audio-activation button\').textContent===\'Wird aktiviert …\'&&__activationNotice.getAttribute(\'aria-busy\')===\'true\'&&__activationPlays===__activationBefore+1');
    await c.evaluate('document.querySelector(\'.audio-activation button\').dispatchEvent(new MouseEvent(\'click\',{bubbles:true}))');
    await verify('Repeated activation during an outstanding probe does not create another player or probe', '__activationPlays===__activationBefore+1');
    await c.evaluate('__activationHold=false;__activationRelease()');
    await settle('__activationNotice.hidden');
    await verify('Completing the permission check removes the pending request without starting a spoken test', 'btsSpeechService.settings().audio_ready&&__activationNotice.hidden&&__activationRequests.length===0&&__localAnnouncements.length===0');
    await c.evaluate('__activationFail=\'NotSupportedError\';__activationService();btsSpeechService.checkAudio()');
    await verify('An unsupported audio format is not presented as a browser permission denial', 'btsSpeechService.settings().audio_error===\'audio_failed\'&&__activationNotice.hidden');
    await c.evaluate('__activationFail=null;__activationSettings.key=null;__activationService();window.dispatchEvent(new CustomEvent(\'bts-speech-output-changed\'));window.__activationBefore=__activationPlays;btsSpeechService.checkAudio()');
    await verify('No tournament means no unnecessary playback probe or permission request', '__activationPlays===__activationBefore&&__activationNotice.hidden');
    await verify('Audio activation and workspace navigation produce no JavaScript exceptions', '__activationErrors.length===0');
    await c.evaluate('__activationContext.close()');
    fs.writeFileSync(path.join(previews, 'audio-activation-verification.json'), JSON.stringify({checks}, null, 2) + '\n');
};
