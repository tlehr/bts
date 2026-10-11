'use strict';

const assert = require('assert');
const zlib = require('zlib');
const xmldom = require('xmldom');

function el2obj(el) {
	const res = {};
	for (let i = 0;i < el.childNodes.length;i++) {
		const c = el.childNodes[i];
		if (c.nodeType === c.TEXT_NODE) {
			// Whitespace in indented XML
			assert(/^\s*$/.test(c.data));
			continue;
		}
		let item;

		if (c.tagName === 'GROUP') {
			item = el2obj(c);
		} else if (c.tagName === 'ITEM') {
			const itype = c.getAttribute('TYPE');
			if (itype === 'String') {
				item = c.textContent;
			} else if (itype === 'Integer') {
				item = parseInt(c.textContent);
			} else if (itype === 'Float') {
				item = parseFloat(c.textContent);
			} else if (itype === 'Bool') {
				item = c.textContent === 'true';
			} else if (itype === 'DateTime') {
				const dt = c.getElementsByTagName('DATETIME')[0];
				item = {
					_type: 'datetime',
					year: parseInt(dt.getAttribute('Y')),
					month: parseInt(dt.getAttribute('MM')),
					day: parseInt(dt.getAttribute('D')),
					hour: parseInt(dt.getAttribute('H')),
					minute: parseInt(dt.getAttribute('M')),
					second: parseInt(dt.getAttribute('S')),
					ms: parseInt(dt.getAttribute('MS')),
				};
			} else {
				throw new Error('Unsupported BTP item type ' + itype);
			}
		} else {
			throw new Error('Unsupported BTP tag ' + c.tagName);
		}

		const id = c.getAttribute('ID');
		if (!res[id]) {
			res[id] = [];
		}
		res[id].push(item);
	}
	return res;
}

function decode_string(buf, callback, timing) {
	if (buf.length < 4) {
		return callback(new Error('Got only ' + buf.length + ' bytes'));
	}

	const expect_len = buf.readInt32BE(0);
	if (buf.length - 4 !== expect_len) {
		return callback(new Error('Expected a message of 4+' + expect_len + ' Bytes, but got ' + buf.length));
	}

	const main_buf = buf.slice(4);
	const decompress = () => zlib.gunzipSync(main_buf, {});
	const response_buf = timing ? timing.measure('decompress', decompress) : decompress();
	if (timing) timing.xml_bytes = response_buf.length;
	const utf8 = () => response_buf.toString('utf8');
	callback(null, timing ? timing.measure('utf8', utf8) : utf8());
}

function parse(xml, timing) {
	const parse_xml = () => new xmldom.DOMParser().parseFromString(xml);
	const doc = timing ? timing.measure('xml_parse', parse_xml) : parse_xml();
	const convert = () => el2obj(doc.documentElement);
	return timing ? timing.measure('object_conversion', convert) : convert();
}

function decode(buf, timing) {
	let response;
	decode_string(buf, (err, xml) => {
		if (err) throw err;
		try { response = parse(xml, timing); }
		catch (error) { error.btp_parse_error = true; throw error; }
	}, timing);
	return response;
}

module.exports = { el2obj, decode_string, parse, decode };
