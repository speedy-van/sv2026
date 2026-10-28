import { render } from '@testing-library/react-native';
import { JobCardView } from '../src/components/job-card';
import { JobCardSchema, ProfileSchema } from '../src/data/driver';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const job = {
  bookingId: 'test-booking', dispatchStatus: 'ACCEPTED', earningPence: null,
  jobStage: 'NOT_STARTED', moveDate: '2026-10-16', reference: 'SV-TEST',
  route: 'Glasgow to Edinburgh', service: 'home', slot: 'MORNING',
};

describe('phone-agreed driver payout', () => {
  it('accepts an unset payout and job earning without substituting zero', () => {
    expect(JobCardSchema.parse(job).earningPence).toBeNull();
    expect(ProfileSchema.parse({
      email: 'driver@example.test', homePostcode: null, licenceExpiry: null,
      name: 'Test Driver', payoutPercent: null, phone: '+447700900123',
    }).payoutPercent).toBeNull();
  });

  it('shows the phone agreement on a job card and preserves a real agreed numeric amount', async () => {
    const view = await render(<JobCardView job={job} />);
    expect(view.getByText('Agreed by phone')).toBeTruthy();
    expect(view.queryByText('£0.00')).toBeNull();
    await view.rerender(<JobCardView job={{ ...job, earningPence: 5400 }} />);
    expect(view.getByText('£54.00')).toBeTruthy();
    expect(view.queryByText('Agreed by phone')).toBeNull();
  });
});
