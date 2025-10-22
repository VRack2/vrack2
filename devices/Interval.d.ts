import { Device } from "vrack2-core";
import BasicAction from "vrack2-core/lib/actions/BasicAction";
import BasicMetric from "vrack2-core/lib/metrics/BasicMetric";
import BasicPort from "vrack2-core/lib/ports/BasicPort";
import BasicType from "vrack2-core/lib/validator/types/BasicType";
export default class Interval extends Device {
    outputs(): {
        [key: string]: BasicPort;
    };
    actions(): {
        [key: string]: BasicAction;
    };
    checkOptions(): {
        [key: string]: BasicType;
    };
    metrics(): {
        [key: string]: BasicMetric;
    };
    shares: {
        count: number;
    };
    process(): void;
    actionTestAction(data: {
        id: string;
    }): string[];
}
