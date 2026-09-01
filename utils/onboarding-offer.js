const FREE_ONBOARDING_END = new Date('2026-10-01T00:00:00+01:00');

function isFreeOnboardingOfferActive(now = new Date()) {
  return now < FREE_ONBOARDING_END;
}

module.exports = { FREE_ONBOARDING_END, isFreeOnboardingOfferActive };
