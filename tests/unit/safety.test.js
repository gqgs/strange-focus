import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { safeToLeave } from '../../extension/safety.js';

// Chrome serializes executeScript.func without its module scope. Run every
// case in a fresh realm so a new dependency on an imported helper also fails.
const safetyScript = new Script(`(${safeToLeave.toString()})(expectedUrl)`);
const articleUrl = 'https://en.wikipedia.org/wiki/Example';

function control(overrides = {}, ancestorIds = []) {
  return {
    tagName: 'INPUT', type: 'text', id: '', name: '',
    value: '', defaultValue: '', checked: false, defaultChecked: false,
    files: [],
    closest(selector) {
      assert.equal(selector, '#vector-appearance');
      return ancestorIds.includes('vector-appearance') ? { id: 'vector-appearance' } : null;
    },
    ...overrides,
  };
}

function preference(feature, value, overrides = {}, ancestorIds = ['vector-appearance']) {
  return control({
    type: 'radio', id: `skin-client-pref-${feature}-value-${value}`,
    name: `skin-client-pref-${feature}-group`, value, defaultValue: value,
    checked: true, defaultChecked: false, ...overrides,
  }, ancestorIds);
}

function check({ href = articleUrl, expectedUrl = href, controls = [], nodes = [] } = {}) {
  const document = {
    querySelector(selector) {
      if (selector === 'iframe, frame') return nodes.find(node => ['IFRAME', 'FRAME'].includes(node.tagName)) ?? null;
      if (selector === '[contenteditable]:not([contenteditable="false"])') {
        return nodes.find(node => Object.hasOwn(node, 'contenteditable') && node.contenteditable !== 'false') ?? null;
      }
      assert.fail(`Unexpected document selector: ${selector}`);
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'input, textarea, select');
      return controls;
    },
  };
  return safetyScript.runInNewContext({
    location: { href, hostname: new URL(href).hostname }, document, expectedUrl,
  }, { timeout: 1000 });
}

test('serialized safety function runs without module globals on an untouched page', () => {
  assert.equal(check(), true);
  assert.equal(check({ href: 'https://example.com/article' }), true);
});

const readingPreferences = [
  ['vector-feature-custom-font-size', ['0', '1', '2']],
  ['vector-feature-limited-width', ['0', '1']],
  ['skin-theme', ['os', 'day', 'night']],
];

for (const [feature, values] of readingPreferences) {
  for (const value of values) {
    test(`Wikipedia Appearance exempts ${feature}=${value}, in either checked direction`, () => {
      for (const hostname of ['wikipedia.org', 'en.wikipedia.org', 'de.wikipedia.org', 'en.m.wikipedia.org']) {
        for (const checked of [true, false]) {
          assert.equal(check({
            href: `https://${hostname}/wiki/Example`,
            controls: [preference(feature, value, { checked, defaultChecked: !checked })],
          }), true, `${hostname}, checked=${checked}`);
        }
      }
    });
  }
}

test('Appearance exemption is not granted to unrelated or deceptive hostnames', () => {
  for (const href of [
    'https://example.com/wiki/Example',
    'https://wikimedia.org/wiki/Example',
    'https://notwikipedia.org/wiki/Example',
    'https://enwikipedia.org/wiki/Example',
    'https://wikipedia.org.example.com/wiki/Example',
    'https://en.wikipedia.org.example.com/wiki/Example',
    'https://en.wikipedia.org@example.com/wiki/Example',
  ]) {
    for (const [feature, values] of readingPreferences) {
      for (const value of values) {
        assert.equal(check({ href, controls: [preference(feature, value)] }), 'edited-form', href);
      }
    }
  }
});

test('a matching Appearance radio outside the exact Appearance ancestry remains protected', () => {
  for (const ancestorIds of [[], ['vector-appearance-copy'], ['vector-appearance-pinned-container']]) {
    assert.equal(check({ controls: [preference('skin-theme', 'day', {}, ancestorIds)] }), 'edited-form');
  }
});

test('Appearance controls must have the exact matching id, name, value, and radio type', () => {
  for (const patch of [
    { id: '' },
    { id: 'skin-client-pref-skin-theme-value-night' },
    { id: 'skin-client-pref-skin-theme-value-day-copy' },
    { name: '' },
    { name: 'skin-client-pref-skin-theme-group-copy' },
    { name: 'skin-client-pref-vector-feature-limited-width-group' },
    { value: 'night' },
    { value: 'day ' },
    { value: 'DAY' },
    { type: 'checkbox' },
  ]) {
    assert.equal(check({ controls: [preference('skin-theme', 'day', patch)] }), 'edited-form', JSON.stringify(patch));
  }
});

test('unknown features and values in Appearance are not exempted', () => {
  for (const [feature, value] of [
    ['unknown-feature', '1'],
    ['vector-feature-custom-font-size', '3'],
    ['vector-feature-limited-width', '2'],
    ['skin-theme', 'auto'],
    ['skin-theme', ''],
  ]) {
    assert.equal(check({ controls: [preference(feature, value)] }), 'edited-form', `${feature}=${value}`);
  }
});

const editedControls = [
  ['text input', () => control({ value: 'unsaved text', defaultValue: '' })],
  ['textarea', () => control({ tagName: 'TEXTAREA', type: 'textarea', value: 'unsaved draft', defaultValue: 'original' })],
  ['checked checkbox', () => control({ type: 'checkbox', checked: true })],
  ['unchecked checkbox', () => control({ type: 'checkbox', defaultChecked: true })],
  ['checked radio', () => control({ type: 'radio', checked: true })],
  ['unchecked radio', () => control({ type: 'radio', defaultChecked: true })],
  ['select with a newly selected option', () => control({ tagName: 'SELECT', type: 'select-one', options: [{ selected: true, defaultSelected: false }] })],
  ['select with a deselected option', () => control({ tagName: 'SELECT', type: 'select-multiple', options: [{ selected: false, defaultSelected: true }] })],
  ['file input', () => control({ type: 'file', files: [{ name: 'unsaved-upload.txt' }] })],
];

for (const [label, makeControl] of editedControls) {
  test(`dirty ${label} remains protected, including beside exempt Appearance controls`, () => {
    assert.equal(check({ href: 'https://example.com/form', controls: [makeControl()] }), 'edited-form');
    const appearance = preference('skin-theme', 'day');
    assert.equal(check({ controls: [appearance, makeControl()] }), 'edited-form');
    assert.equal(check({ controls: [makeControl(), appearance] }), 'edited-form');
  });
}

test('unchanged form controls and an empty file input do not block capture', () => {
  assert.equal(check({ controls: [
    control({ value: 'initial text', defaultValue: 'initial text' }),
    control({ tagName: 'TEXTAREA', type: 'textarea', value: 'initial draft', defaultValue: 'initial draft' }),
    control({ type: 'checkbox', checked: true, defaultChecked: true }),
    control({ type: 'checkbox' }),
    control({ type: 'radio', checked: true, defaultChecked: true }),
    control({ type: 'radio' }),
    control({ tagName: 'SELECT', type: 'select-one', options: [
      { selected: true, defaultSelected: true }, { selected: false, defaultSelected: false },
    ] }),
    control({ type: 'file', files: [] }),
  ] }), true);
});

test('frames block capture even when Appearance controls are otherwise exempt', () => {
  for (const tagName of ['IFRAME', 'FRAME']) {
    assert.equal(check({ nodes: [{ tagName }], controls: [preference('skin-theme', 'day')] }), 'frames');
  }
});

test('contenteditable editors block capture but contenteditable=false does not', () => {
  for (const contenteditable of ['', 'true', 'plaintext-only']) {
    assert.equal(check({ nodes: [{ tagName: 'DIV', contenteditable }], controls: [preference('skin-theme', 'day')] }), 'editor');
  }
  assert.equal(check({ nodes: [{ tagName: 'DIV', contenteditable: 'false' }] }), true);
});

test('a changed URL returns page-changed before considering the page contents', () => {
  for (const href of [
    `${articleUrl}#History`, `${articleUrl}?action=edit`,
    'https://en.wikipedia.org/wiki/Another_article', 'https://example.com/wiki/Example',
  ]) {
    assert.equal(check({ href, expectedUrl: articleUrl }), 'page-changed');
  }
  assert.equal(check({
    href: `${articleUrl}?action=edit`, expectedUrl: articleUrl,
    nodes: [{ tagName: 'IFRAME' }, { tagName: 'DIV', contenteditable: 'true' }],
    controls: [control({ value: 'private unsaved content' })],
  }), 'page-changed');
});
