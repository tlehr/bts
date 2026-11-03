'use strict';

// BTS administers the speech server through its private API. Worker tokens,
// leases, queues and raw helper results belong exclusively to that server.
class RemoteHelpers {
    constructor(broker) {this.broker = broker;this.central = true;}
    async request(method, pathname, body) {
        const b = this.broker;
        if (!b.config.enabled) throw new Error('speech_unavailable');
        try {return await b.request(b.config.base_url,b.config.api_key,method,pathname,body,b.config.timeout_ms);}
        catch (error) {
            const code = error.response?.error?.code;
            throw new Error(error.status === 404 ? 'helper_server_update_required' : /^helper_[a-z_]+$/.test(code || '') ? code : 'speech_unavailable');
        }
    }
    async snapshot(tournament) {
        const value = await this.request('GET','/v1/helpers?tournament='+encodeURIComponent(tournament));
        return {...value,endpoint:value.endpoint || this.broker.config.base_url};
    }
    pair() {return this.request('POST','/v1/helpers/pair',{});}
    bundle(endpoint,platform='windows') {return this.request('POST','/v1/helpers/bundle',{endpoint,platform});}
    test(tournament,voice,worker_id) {return this.request('POST','/v1/helpers/test',{tournament,voice,worker_id});}
    control(worker_id,action) {return this.request('POST','/v1/helpers/control',{worker_id,action});}
}
module.exports = {RemoteHelpers};
