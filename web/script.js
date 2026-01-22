// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Demo modal functionality
function showDemo() {
    const modal = document.getElementById('demo-modal');
    modal.style.display = 'block';
    simulateDemo();
}

function closeDemo() {
    const modal = document.getElementById('demo-modal');
    modal.style.display = 'none';
    const output = document.getElementById('demo-output');
    output.textContent = '';
}

// Simulate a demo workflow
async function simulateDemo() {
    const output = document.getElementById('demo-output');
    const steps = [
        { text: '$ jira issue create --project DEMO --summary "Update login page copy"\n', delay: 100 },
        { text: '✓ Issue DEMO-123 created\n', delay: 500 },
        { text: '$ jira issue assign DEMO-123 --user ai-agent@example.com\n', delay: 500 },
        { text: '✓ Issue assigned to AI Agent\n\n', delay: 500 },
        { text: '🔥 Firebase Function triggered...\n', delay: 800 },
        { text: '📦 Webhook received from Jira\n', delay: 500 },
        { text: '🚀 Dispatching GitHub Actions workflow...\n\n', delay: 1000 },
        { text: '🐙 GitHub Actions: Workflow started\n', delay: 500 },
        { text: '📝 Creating branch: ai/DEMO-123-auto\n', delay: 500 },
        { text: '🤖 Calling Claude AI for implementation...\n', delay: 1000 },
        { text: '✏️  Generating code changes...\n', delay: 2000 },
        { text: '📄 Files modified:\n', delay: 300 },
        { text: '   - src/pages/Login.jsx\n', delay: 200 },
        { text: '   - src/locales/en.json\n', delay: 200 },
        { text: '   - tests/login.test.js\n\n', delay: 200 },
        { text: '💾 Committing changes...\n', delay: 500 },
        { text: '⬆️  Pushing to origin/ai/DEMO-123-auto\n', delay: 800 },
        { text: '🔀 Creating Pull Request...\n', delay: 500 },
        { text: '✓ PR #456 opened: "DEMO-123: Update login page copy"\n\n', delay: 500 },
        { text: '📋 Transitioning Jira issue to "In Review"...\n', delay: 500 },
        { text: '✅ Workflow complete!\n\n', delay: 300 },
        { text: 'Time elapsed: 47 seconds\n', delay: 200 },
        { text: 'View PR: https://github.com/example/repo/pull/456', delay: 100 }
    ];

    output.textContent = '';
    
    for (const step of steps) {
        await typeText(output, step.text, step.delay);
    }
}

async function typeText(element, text, delay) {
    return new Promise(resolve => {
        setTimeout(() => {
            element.textContent += text;
            element.scrollTop = element.scrollHeight;
            resolve();
        }, delay);
    });
}

// Copy deploy command
function copyCommand() {
    const command = 'firebase deploy --only hosting,functions';
    navigator.clipboard.writeText(command).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('demo-modal');
    if (event.target === modal) {
        closeDemo();
    }
}

// Add scroll effect to navbar
window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        navbar.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
    } else {
        navbar.style.boxShadow = 'none';
    }
});

// Animate elements on scroll
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe all feature cards and workflow steps
document.addEventListener('DOMContentLoaded', () => {
    const elements = document.querySelectorAll('.feature-card, .workflow-step, .arch-component');
    elements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'all 0.5s ease';
        observer.observe(el);
    });

    // SCRUM-5: Enhanced interactions for workflow steps with modern effects
    const workflowSteps = document.querySelectorAll('.workflow-step');
    workflowSteps.forEach((step, index) => {
        // Add staggered entrance animation
        step.style.animationDelay = `${index * 0.15}s`;
        
        // Add hover sound effect (visual feedback)
        step.addEventListener('mouseenter', () => {
            const icon = step.querySelector('.step-icon');
            if (icon) {
                icon.style.transform = 'scale(1.2) rotate(5deg)';
            }
            
            // Add ripple effect on hover
            const ripple = document.createElement('span');
            ripple.classList.add('hover-ripple');
            step.appendChild(ripple);
            setTimeout(() => ripple.remove(), 1000);
        });
        
        step.addEventListener('mouseleave', () => {
            const icon = step.querySelector('.step-icon');
            if (icon) {
                icon.style.transform = 'scale(1) rotate(0deg)';
            }
        });

        // Add click interaction with ripple effect
        step.addEventListener('click', (e) => {
            step.classList.add('clicked');
            
            // Create ripple effect at click position
            const rect = step.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const ripple = document.createElement('span');
            ripple.classList.add('click-ripple');
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';
            step.appendChild(ripple);
            
            setTimeout(() => {
                step.classList.remove('clicked');
                ripple.remove();
            }, 600);
        });
    });

    // Parallax effect for How It Works section
    const howItWorks = document.querySelector('#how-it-works');
    if (howItWorks) {
        window.addEventListener('scroll', () => {
            const scrolled = window.pageYOffset;
            const rate = scrolled * -0.5;
            
            if (howItWorks.offsetTop < scrolled + window.innerHeight && 
                howItWorks.offsetTop + howItWorks.offsetHeight > scrolled) {
                howItWorks.style.backgroundPositionY = rate + 'px';
            }
        });
    }

    // Add progressive number animation
    const stepNumbers = document.querySelectorAll('.step-number');
    const numberObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('animated')) {
                entry.target.classList.add('animated');
                const finalNumber = parseInt(entry.target.textContent);
                let currentNumber = 0;
                const increment = finalNumber / 20;
                const timer = setInterval(() => {
                    currentNumber += increment;
                    if (currentNumber >= finalNumber) {
                        entry.target.textContent = finalNumber;
                        clearInterval(timer);
                    } else {
                        entry.target.textContent = Math.floor(currentNumber);
                    }
                }, 50);
            }
        });
    }, { threshold: 0.5 });

    stepNumbers.forEach(num => {
        numberObserver.observe(num);
    });
});