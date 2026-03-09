const scrollButtons = document.querySelectorAll('[data-scroll]');

scrollButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.querySelector(button.dataset.scroll);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

const form = document.getElementById('rsvpForm');
const note = document.getElementById('rsvpNote');

const RSVP_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxF63V1OITf4qAvP-QzDcTFCDkTj-UmQENKOH5wU-g5kxppXC1j0zEQZ-54GND2LqhelQ/exec';

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    // Backward compatibility for pages that still use the old field name.
    if (!data.after_party_attendance && data.afterparty_attendance) {
      data.after_party_attendance = data.afterparty_attendance;
    }
    if (note) {
      note.textContent = 'Sending RSVP...';
    }

    try {
      const response = await fetch(RSVP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rawResult = await response.text();
      const result = rawResult.trim().toLowerCase();
      if (result !== 'ok') {
        throw new Error(`Unexpected response: ${result || 'empty'}`);
      }

      if (note) {
        note.textContent = 'Thanks! Your RSVP has been submitted.';
      }
      form.reset();
    } catch (err) {
      console.error('RSVP submission failed:', err);
      if (note) {
        note.textContent = 'Submission failed. Verify Apps Script is deployed as Web App with access set to Anyone.';
      }
    }
  });
}

const REGISTRY_WEBSITE_LINKS = [
  { label: 'Amazon Registry', url: 'https://www.amazon.com/wedding/guest-view/2TMKQZYJ4WLQJ' },
  { label: 'Wayfair', url: 'https://www.wayfair.com/lists/favorites/2260988781/shah3TGhxw' },
];

const registryLinksEl = document.getElementById('registryLinks');
const registryGridEl = document.getElementById('registryGrid');
const registryNoteEl = document.getElementById('registryNote');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRegistryLinks() {
  if (!registryLinksEl) {
    return;
  }

  registryLinksEl.innerHTML = REGISTRY_WEBSITE_LINKS.map((link) => `
      <a class="btn btn--primary btn--small registry-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(link.label)}
      </a>
    `).join('');
}

function initRegistryLinksOnly() {
  renderRegistryLinks();

  if (registryGridEl) {
    registryGridEl.innerHTML = '';
    registryGridEl.style.display = 'none';
  }

  if (registryNoteEl) {
    registryNoteEl.textContent = 'Thank you for celebrating with us.';
  }
}

initRegistryLinksOnly();
