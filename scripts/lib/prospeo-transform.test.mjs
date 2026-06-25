import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripFlags, parseLocation, domainOf, companyKey, prospeoGroupToLead, prospeoRowsToLeads,
} from './prospeo-transform.mjs';

const singitaA = {
  person_name: 'Penny Telfer', person_title: 'Lodge Manager, Singita Mara River',
  email: '', email_status: 'hidden', company: 'Singita', ai_tier: '1',
  phone: '021 683 3424 🇿🇦', website: 'https://singita.com/',
  location: 'Cape Town, Western Cape, South Africa 🇿🇦', founded: '1993',
  employees: '628', revenue: 'USD 5M', industry: 'Hospitality',
  linkedin: 'https://www.linkedin.com/company/singita', description: 'Conservation-led lodges.',
};
const singitaB = {
  person_name: 'Mark Witney', person_title: 'Managing Director',
  email: 'mark@singita.com', email_status: 'revealed', company: 'Singita',
  phone: '', website: 'https://www.singita.com', location: 'South Africa 🇿🇦',
  industry: 'Hospitality', linkedin: 'https://linkedin.com/in/markwitney', description: 'MD bio.',
};

test('stripFlags removes emoji flags and trims', () => {
  assert.equal(stripFlags('021 683 3424 🇿🇦'), '021 683 3424');
  assert.equal(stripFlags('South Africa 🇿🇦'), 'South Africa');
});

test('parseLocation: full address -> country last, region rest', () => {
  assert.deepEqual(parseLocation('Cape Town, Western Cape, South Africa 🇿🇦'),
    { country: 'South Africa', region: 'Cape Town, Western Cape' });
});

test('parseLocation: country only', () => {
  assert.deepEqual(parseLocation('Kenya 🇰🇪'), { country: 'Kenya', region: '' });
});

test('domainOf normalises url', () => {
  assert.equal(domainOf('https://www.singita.com/'), 'singita.com');
});

test('companyKey groups by domain regardless of www/protocol', () => {
  assert.equal(companyKey(singitaA), companyKey(singitaB));
});

test('prospeoGroupToLead collapses people into one company lead', () => {
  const lead = prospeoGroupToLead([singitaA, singitaB]);
  assert.equal(lead.businessName, 'Singita');
  assert.equal(lead.country, 'South Africa');
  assert.equal(lead.website, 'https://singita.com/');
  assert.equal(lead.contacts.length, 2);
  // MD outranks Lodge Manager -> owner is the MD, listed first.
  assert.equal(lead.ownerName, 'Mark Witney');
  assert.equal(lead.contacts[0].name, 'Mark Witney');
  // revealed email captured, hidden/empty dropped
  assert.deepEqual(lead.emails, [{ address: 'mark@singita.com' }]);
  // phone flag stripped
  assert.deepEqual(lead.phones, [{ number: '021 683 3424' }]);
  assert.equal(lead.firmographics.employees, '628');
  assert.equal(lead.firmographics.socials.linkedin, 'https://www.linkedin.com/company/singita');
  assert.equal(lead.crm.stage, 1);
  assert.ok(lead.id.startsWith('singita-'));
});

test('contact carries linkedin and title', () => {
  const lead = prospeoGroupToLead([singitaA]);
  assert.equal(lead.contacts[0].linkedin, 'https://www.linkedin.com/company/singita');
  assert.ok(lead.contacts[0].title.includes('Lodge Manager'));
});

test('prospeoRowsToLeads de-dups companies', () => {
  const other = { ...singitaA, company: 'Asilia', website: 'https://asilia.com', person_name: 'Jo Bloggs' };
  const leads = prospeoRowsToLeads([singitaA, singitaB, other]);
  assert.equal(leads.length, 2);
});

test('rows with no company and no person are skipped', () => {
  const leads = prospeoRowsToLeads([{ company: '', person_name: '', website: '' }, singitaA]);
  assert.equal(leads.length, 1);
});
