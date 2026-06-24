import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvRowToLead, deriveSegment } from './transform.mjs';

const lodgeRow = {
  Name: 'Emdoneni Lodge', Country: 'South Africa', 'Region/Park': 'KwaZulu-Natal',
  Type: 'Lodge', Website: 'https://emdonenilodge.com', Email: 'info@emdonenilodge.com',
  Phone: '+27 35 562 7000', WhatsApp: '', 'Established/Size': '',
  Description: 'Family lodge', BookingChannels: 'Email',
  'FunnelLeak/Audit': 'Single inbox', 'OutreachAngle/Message': 'Hi — enquiries wait',
  Source: 'agent-batch-2026-06-23',
};

test('deriveSegment: lodge with no group markers -> small_lodge', () => {
  assert.equal(deriveSegment(lodgeRow), 'small_lodge');
});

test('deriveSegment: collection markers -> large_collection', () => {
  assert.equal(deriveSegment({ ...lodgeRow, Name: 'Olifani Safari Collection', Type: 'Lodge collection' }), 'large_collection');
});

test('deriveSegment: small operator', () => {
  assert.equal(deriveSegment({ ...lodgeRow, Type: 'Tour operator/DMC', 'Established/Size': 'KATO Category E' }), 'small_operator');
});

test('deriveSegment: large operator via category A', () => {
  assert.equal(deriveSegment({ ...lodgeRow, Type: 'Tour operator/DMC', 'Established/Size': 'KATO Category A' }), 'large_operator');
});

test('deriveSegment: no email and no website -> phone_only', () => {
  assert.equal(deriveSegment({ ...lodgeRow, Email: '', Website: '', Phone: '+267 686 1449' }), 'phone_only');
});

test('csvRowToLead maps fields and arrays', () => {
  const lead = csvRowToLead(lodgeRow);
  assert.equal(lead.businessName, 'Emdoneni Lodge');
  assert.equal(lead.country, 'South Africa');
  assert.equal(lead.region, 'KwaZulu-Natal');
  assert.deepEqual(lead.emails, ['info@emdonenilodge.com']);
  assert.deepEqual(lead.phones, ['+27 35 562 7000']);
  assert.equal(lead.segment, 'small_lodge');
  assert.equal(lead.funnelLeak, 'Single inbox');
  assert.equal(lead.outreachAngle, 'Hi — enquiries wait');
  assert.equal(lead.crm.stage, 1);
  assert.ok(typeof lead.id === 'string' && lead.id.length > 0);
});

test('csvRowToLead handles missing email (no empty-string entries)', () => {
  const lead = csvRowToLead({ ...lodgeRow, Email: '', WhatsApp: '+27 11 000 0000' });
  assert.deepEqual(lead.emails, []);
  assert.equal(lead.whatsapp, '+27 11 000 0000');
});
