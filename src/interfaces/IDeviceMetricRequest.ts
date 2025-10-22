
export default interface IDeviceMetricRequest {
    /** 
     * Service ID
    */
    service: string;

    /**
     * Device ID in this service
    */
    device: string;
    /** 
     * Metric ID in this device in this service
     */
    metric: string;
    /** 
     * VRack-DB period 
     * @see vrack-db.SingleDB.read
     */
    period: string;
    /** 
     * Precission in string 
     * @see vrack-db.SingleDB.read
     */
    precision: string;

    /**
     * Aggregation fumction
     * @see vrack-db.SingleDB.read
    */
    func: string;
}
