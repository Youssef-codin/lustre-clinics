/**
 * The day view's icons — `lucide-react-native`, wrapped. The wrapper is thin
 * and does two things: it names each icon after the job it does here rather
 * than after its shape, and it keeps `stroke`/`width` as props so the call
 * sites read the same as every other styled thing and the library stays
 * swappable from one file. The procedure icon is a stethoscope: the design
 * draws a molar, Lucide has no tooth, and a hand-traced one-off is how a
 * project ends up with two icon sets.
 */
import {
    ArrowLeft,
    ArrowRight,
    Calendar,
    Check,
    Clock,
    Coins,
    CreditCard,
    Hourglass,
    MapPin,
    MessageCircle,
    Plus,
    Receipt,
    Stethoscope,
    Timer,
    User,
    X,
    Zap,
} from 'lucide-react-native';
import { color } from '../../../theme';

type IconProps = {
    size?: number;
    stroke?: string;
    width?: number;
};

type Glyph = typeof Clock;

function icon(Glyph: Glyph, defaultWidth = 2) {
    return function Wrapped({ size = 15, stroke = color.muted, width = defaultWidth }: IconProps) {
        return <Glyph size={size} color={stroke} strokeWidth={width} />;
    };
}

export const PinIcon = icon(MapPin);

export const CalendarIcon = icon(Calendar);

export const ClockIcon = icon(Clock);

export const ProcedureIcon = icon(Stethoscope, 1.8);

export const ArrowBackIcon = icon(ArrowLeft, 2.2);

export const ArrowForwardIcon = icon(ArrowRight, 2.2);

export const ChatIcon = icon(MessageCircle);

export const CloseIcon = icon(X, 2.2);

export const CheckIcon = icon(Check, 2.4);

export const WaitingIcon = icon(Hourglass, 2.2);

/** How long a booking runs. Not `WaitingIcon` — the hourglass is spoken for by
 * the patient who is waiting, and a duration is not a wait. */
export const DurationIcon = icon(Timer);

export const PatientIcon = icon(User);

export const ChairIcon = icon(Stethoscope, 2);

export const PaymentIcon = icon(CreditCard, 2.2);

export const PlusIcon = icon(Plus, 2.4);

/** The catalogue's remove — `CloseIcon` is a dismiss, this ends a line. */
export const XIcon = icon(X, 2.2);

// The four ways the clinic is paid. `PaymentIcon` is the card already, so the
// payment screen's Card tile reuses it rather than naming the same glyph twice.
export const CashIcon = icon(Coins, 1.8);

export const InstapayIcon = icon(Zap, 1.8);

export const OtherMethodIcon = icon(Receipt, 1.8);
