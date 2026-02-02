// DilloBot Landing Page JavaScript
// Particles, interactions, and visual effects

document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initCopyButtons();
    initScrollAnimations();
    initNavHighlight();
    initTerminalAnimation();
    initInstallTabs();
});

// Install method tabs
function initInstallTabs() {
    const tabs = document.querySelectorAll('.install-tab');
    const contents = document.querySelectorAll('.install-tab-content');

    if (!tabs.length) return;

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = `tab-${tab.dataset.tab}`;

            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active content
            contents.forEach(content => {
                content.classList.remove('active');
                if (content.id === targetId) {
                    content.classList.add('active');
                }
            });
        });
    });
}

// Particle System
function initParticles() {
    const canvas = document.getElementById('particles');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let particles = [];
    let animationId;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    resize();
    window.addEventListener('resize', resize);

    class Particle {
        constructor() {
            this.reset();
        }

        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2 + 0.5;
            this.speedX = (Math.random() - 0.5) * 0.3;
            this.speedY = (Math.random() - 0.5) * 0.3;
            this.opacity = Math.random() * 0.5 + 0.1;
            this.color = Math.random() > 0.7 ? '#4ade80' : '#B8956E';
        }

        update() {
            this.x += this.speedX;
            this.y += this.speedY;

            // Wrap around edges
            if (this.x < 0) this.x = canvas.width;
            if (this.x > canvas.width) this.x = 0;
            if (this.y < 0) this.y = canvas.height;
            if (this.y > canvas.height) this.y = 0;
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.globalAlpha = this.opacity;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    // Create particles
    const particleCount = Math.min(100, Math.floor((canvas.width * canvas.height) / 15000));
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }

    // Draw connections between nearby particles
    function drawConnections() {
        const maxDistance = 120;
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 0.5;

        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < maxDistance) {
                    ctx.globalAlpha = (1 - distance / maxDistance) * 0.15;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 1;
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach(particle => {
            particle.update();
            particle.draw();
        });

        drawConnections();
        animationId = requestAnimationFrame(animate);
    }

    animate();

    // Mouse interaction
    let mouse = { x: null, y: null };
    const mouseRadius = 150;

    canvas.addEventListener('mousemove', (e) => {
        mouse.x = e.x;
        mouse.y = e.y;

        particles.forEach(particle => {
            const dx = particle.x - mouse.x;
            const dy = particle.y - mouse.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < mouseRadius) {
                const angle = Math.atan2(dy, dx);
                const force = (mouseRadius - distance) / mouseRadius;
                particle.x += Math.cos(angle) * force * 2;
                particle.y += Math.sin(angle) * force * 2;
            }
        });
    });

    canvas.addEventListener('mouseleave', () => {
        mouse.x = null;
        mouse.y = null;
    });
}

// Copy to clipboard
function initCopyButtons() {
    const copyButtons = document.querySelectorAll('.copy-btn');

    copyButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const textToCopy = btn.dataset.copy;

            try {
                await navigator.clipboard.writeText(textToCopy);
                btn.classList.add('copied');
                btn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 6L9 17l-5-5"/>
                    </svg>
                `;

                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = `
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                    `;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        });
    });
}

// Scroll-triggered animations
function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Add animation classes
    const animateElements = document.querySelectorAll(
        '.feature-card, .comparison-table, .install-hero, .install-tabs-container, .platform-support, .arch-layer, .mascot-quote'
    );

    animateElements.forEach((el, index) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = `opacity 0.6s ease ${index * 0.05}s, transform 0.6s ease ${index * 0.05}s`;
        observer.observe(el);
    });

    // Add the animate-in style
    const style = document.createElement('style');
    style.textContent = `
        .animate-in {
            opacity: 1 !important;
            transform: translateY(0) !important;
        }
    `;
    document.head.appendChild(style);
}

// Navigation highlight on scroll
function initNavHighlight() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

    function highlightNav() {
        const scrollPos = window.scrollY + 100;

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute('id');

            if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
                navLinks.forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${sectionId}`) {
                        link.classList.add('active');
                    }
                });
            }
        });
    }

    window.addEventListener('scroll', highlightNav);

    // Add active style
    const style = document.createElement('style');
    style.textContent = `
        .nav-links a.active {
            color: var(--accent);
        }
    `;
    document.head.appendChild(style);
}

// Terminal typing animation enhancement
function initTerminalAnimation() {
    const terminal = document.querySelector('.terminal-window');
    if (!terminal) return;

    // Add glow effect on hover
    terminal.addEventListener('mouseenter', () => {
        terminal.style.boxShadow = `
            0 0 0 1px rgba(74, 222, 128, 0.2),
            0 20px 50px rgba(0, 0, 0, 0.5),
            0 0 150px rgba(74, 222, 128, 0.15)
        `;
    });

    terminal.addEventListener('mouseleave', () => {
        terminal.style.boxShadow = `
            0 0 0 1px rgba(74, 222, 128, 0.1),
            0 20px 50px rgba(0, 0, 0, 0.5),
            0 0 100px rgba(74, 222, 128, 0.1)
        `;
    });
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const navHeight = document.querySelector('.nav').offsetHeight;
            const targetPosition = target.offsetTop - navHeight - 20;

            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// Add hover effects to comparison table rows
document.querySelectorAll('.comparison-table tbody tr').forEach(row => {
    row.addEventListener('mouseenter', () => {
        const cells = row.querySelectorAll('td');
        cells.forEach(cell => {
            if (cell.classList.contains('dillobot-col')) {
                cell.style.background = 'rgba(74, 222, 128, 0.08)';
            }
        });
    });

    row.addEventListener('mouseleave', () => {
        const cells = row.querySelectorAll('td');
        cells.forEach(cell => {
            if (cell.classList.contains('dillobot-col')) {
                cell.style.background = 'rgba(74, 222, 128, 0.03)';
            }
        });
    });
});

// Easter egg: Konami code
let konamiCode = [];
const konamiSequence = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
    'KeyB', 'KeyA'
];

document.addEventListener('keydown', (e) => {
    konamiCode.push(e.code);
    konamiCode = konamiCode.slice(-10);

    if (konamiCode.join(',') === konamiSequence.join(',')) {
        // Trigger armadillo roll animation
        const mascot = document.querySelector('.mascot-svg');
        if (mascot) {
            mascot.style.transition = 'transform 1s ease-in-out';
            mascot.style.transform = 'rotate(360deg)';
            setTimeout(() => {
                mascot.style.transform = 'rotate(0deg)';
            }, 1000);
        }

        // Show a fun message
        const msg = document.createElement('div');
        msg.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(15, 31, 15, 0.95);
            border: 2px solid #4ade80;
            padding: 30px 50px;
            border-radius: 16px;
            z-index: 9999;
            text-align: center;
            animation: popIn 0.3s ease;
        `;
        msg.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 10px;">🛡️</div>
            <div style="font-size: 1.2rem; color: #4ade80;">Armored Mode Activated!</div>
            <div style="font-size: 0.9rem; color: #a8d4a8; margin-top: 8px;">The armadillo curls into a ball...</div>
        `;
        document.body.appendChild(msg);

        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes popIn {
                from { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
                to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);

        setTimeout(() => {
            msg.style.animation = 'popIn 0.3s ease reverse';
            setTimeout(() => msg.remove(), 300);
        }, 2000);
    }
});

// Log a fun welcome message
console.log(`
%c🛡️ DilloBot %c- Armored AI

%cWelcome, security-conscious developer!

Looking to contribute? Check out:
https://github.com/AIDilloBot/dillobot

"Like an armadillo, we roll into a ball when threatened."
`,
    'font-size: 24px; font-weight: bold; color: #4ade80;',
    'font-size: 16px; color: #B8956E;',
    'font-size: 12px; color: #a8d4a8;'
);
