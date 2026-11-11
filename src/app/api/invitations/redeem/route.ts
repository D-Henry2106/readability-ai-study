import { NextRequest } from 'next/server';
import { getParticipantSessionId, setParticipantSessionId } from '@/lib/auth/participant-session';
import { InvitationRedemptionService } from '@/lib/services/invitation-redemption.service';
import { handleRedeem } from '@/lib/study-run/redeem-handler';

// Participant entry for a Study Run: the token arrives ONLY in the POST body (the /i page reads it from the URL fragment).
export async function POST(request: NextRequest) {
  return handleRedeem(request, {
    service: new InvitationRedemptionService(),
    getCookieSessionId: getParticipantSessionId,
    setCookieSessionId: setParticipantSessionId
  });
}
