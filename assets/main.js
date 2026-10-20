// Language switcher
function setLang(lang) {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-set-lang]').forEach(function(btn) {
        btn.setAttribute('aria-pressed', btn.getAttribute('data-set-lang') === lang);
    });
}

document.querySelectorAll('[data-set-lang]').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var lang = this.getAttribute('data-set-lang');
        setLang(lang);
        try {
            localStorage.setItem('kn-lang', lang);
        } catch (e) {
            // Storage can be blocked (private mode, site data disabled); the choice then lasts for this page view only
            console.warn('Language preference not saved:', e);
        }
    });
});

// Restore saved language; only known values, since any other lang would show both languages
var savedLang = null;
try {
    savedLang = localStorage.getItem('kn-lang');
} catch (e) {
    console.warn('Saved language preference not readable:', e);
}
if (savedLang === 'en') setLang('en');

// Mobile nav toggle
var navToggle = document.getElementById('navToggle');
var navLinks = document.getElementById('navLinks');

navToggle.addEventListener('click', function() {
    navToggle.setAttribute('aria-expanded', navLinks.classList.toggle('open'));
});

navLinks.querySelectorAll('a').forEach(function(link) {
    link.addEventListener('click', function() {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
    });
});

// Modals: native <dialog> provides focus handling, Escape and an inert background
document.querySelectorAll('[data-modal]').forEach(function(link) {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        document.getElementById('modal-' + this.getAttribute('data-modal')).showModal();
    });
});

document.querySelectorAll('dialog.modal').forEach(function(dialog) {
    function onBackdrop(e) {
        var r = dialog.getBoundingClientRect();
        return e.target === dialog &&
            (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
    }

    // Require press and release on the backdrop, so a text selection dragged out of the dialog keeps it open
    var pressedOnBackdrop = false;
    dialog.addEventListener('pointerdown', function(e) { pressedOnBackdrop = onBackdrop(e); });
    dialog.addEventListener('click', function(e) {
        if (pressedOnBackdrop && onBackdrop(e)) dialog.close();
    });

    dialog.querySelector('.modal-close').addEventListener('click', function() { dialog.close(); });
});

// Scroll reveal
var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.reveal').forEach(function(el) { observer.observe(el); });

// Nav background on scroll
window.addEventListener('scroll', function() {
    document.querySelector('nav').style.background =
        window.scrollY > 50 ? 'rgba(18, 18, 31, 0.95)' : 'rgba(18, 18, 31, 0.85)';
});
