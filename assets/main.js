// Language switcher
document.querySelectorAll('[data-set-lang]').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var lang = this.getAttribute('data-set-lang');
        document.documentElement.lang = lang;
        document.querySelectorAll('.lang-btn').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        try { localStorage.setItem('kn-lang', lang); } catch(e) {}
    });
});

// Restore saved language
try {
    var saved = localStorage.getItem('kn-lang');
    if (saved === 'en') {
        document.documentElement.lang = 'en';
        document.querySelector('[data-set-lang="de"]').classList.remove('active');
        document.querySelector('[data-set-lang="en"]').classList.add('active');
    }
} catch(e) {}

// Mobile nav toggle
document.getElementById('navToggle').addEventListener('click', function() {
    document.getElementById('navLinks').classList.toggle('open');
});

document.querySelectorAll('.nav-links a').forEach(function(link) {
    link.addEventListener('click', function() {
        document.getElementById('navLinks').classList.remove('open');
    });
});

// Scroll reveal
var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
        if (entry.isIntersecting) entry.target.classList.add('visible');
    });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.reveal').forEach(function(el) { observer.observe(el); });

// Nav background on scroll
window.addEventListener('scroll', function() {
    document.querySelector('nav').style.background =
        window.scrollY > 50 ? 'rgba(18, 18, 31, 0.95)' : 'rgba(18, 18, 31, 0.85)';
});

// Modal open/close
function openModal(id) {
    var el = document.getElementById('modal-' + id);
    if (el) {
        el.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(id) {
    var el = document.getElementById('modal-' + id);
    if (el) {
        el.classList.remove('open');
        document.body.style.overflow = '';
    }
}

// Footer modal links
document.querySelectorAll('[data-modal]').forEach(function(link) {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        openModal(this.getAttribute('data-modal'));
    });
});

// Modal close buttons
document.querySelectorAll('.modal-close').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var overlay = this.closest('.modal-overlay');
        if (overlay) {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
        }
    });
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
        }
    });
});
