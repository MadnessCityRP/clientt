import { TOW_SCHEMA } from "@snailycad/schemas";
import { Button } from "components/Button";
import { Error } from "components/form/Error";
import { FormField } from "components/form/FormField";
import { Input } from "components/form/Input";
import { Select } from "components/form/Select";
import { Textarea } from "components/form/Textarea";
import { Loader } from "components/Loader";
import { Modal } from "components/modal/Modal";
import { useModal } from "context/ModalContext";
import { useValues } from "context/ValuesContext";
import { Formik } from "formik";
import { handleValidate } from "lib/handleValidate";
import useFetch from "lib/useFetch";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import { Full911Call } from "state/dispatchState";
import { useEmsFdState } from "state/emsFdState";
import { useLeoState } from "state/leoState";
import { ModalIds } from "types/ModalIds";
import { useTranslations } from "use-intl";

interface Props {
  call: Full911Call | null;
}

export const DispatchCallTowModal = ({ call }: Props) => {
  const common = useTranslations("Common");
  const t = useTranslations("Calls");
  const { isOpen, closeModal } = useModal();
  const { state, execute } = useFetch();
  const { activeOfficer, officers } = useLeoState();
  const { activeDeputy, deputies } = useEmsFdState();
  const router = useRouter();
  const { impoundLot } = useValues();

  const citizensFrom =
    router.pathname === "/officer" ? officers : router.pathname === "/ems-fd" ? deputies : [];
  const citizens = [...citizensFrom].map((v) => v.citizen);
  const unit =
    router.pathname === "/officer"
      ? activeOfficer
      : router.pathname === "/ems-fd"
      ? activeDeputy
      : null;

  async function onSubmit(values: typeof INITIAL_VALUES) {
    const { json } = await execute("/tow", {
      method: "POST",
      data: values,
    });

    if (json.id) {
      // todo: add translation
      toast.success("Created.");
    }

    closeModal(ModalIds.ManageTowCall);
  }

  const validate = handleValidate(TOW_SCHEMA);
  const INITIAL_VALUES = {
    location: call?.location ?? "",
    creatorId: unit?.citizenId ?? "",
    description: call?.description ?? "",
    deliveryAddress: "",
    model: "",
    plate: "",
  };

  return (
    <Modal
      onClose={() => closeModal(ModalIds.ManageTowCall)}
      title={t("createTowCall")}
      isOpen={isOpen(ModalIds.ManageTowCall)}
      className="min-w-[700px]"
    >
      <Formik validate={validate} initialValues={INITIAL_VALUES} onSubmit={onSubmit}>
        {({ handleSubmit, handleChange, values, isValid, errors }) => (
          <form onSubmit={handleSubmit}>
            {unit ? (
              <FormField label={"Citizen"}>
                <Select
                  disabled
                  name="creatorId"
                  onChange={handleChange}
                  values={citizens.map((citizen) => ({
                    label: `${citizen.name} ${citizen.surname}`,
                    value: citizen.id,
                  }))}
                  value={values.creatorId}
                />
                <Error>{errors.creatorId}</Error>
              </FormField>
            ) : null}

            <FormField label={"Location"}>
              <Input disabled onChange={handleChange} name="location" value={values.location} />
              <Error>{errors.location}</Error>
            </FormField>

            <FormField label={"Delivery Address"}>
              <Select
                isClearable
                name="deliveryAddress"
                onChange={handleChange}
                values={impoundLot.values.map((lot) => ({
                  label: lot.value,
                  value: lot.id,
                }))}
                value={values.deliveryAddress}
              />
              <Error>{errors.deliveryAddress}</Error>
            </FormField>

            <FormField label={"Plate"}>
              <Input onChange={handleChange} name="plate" value={values.plate} />
              <Error>{errors.plate}</Error>
            </FormField>

            <FormField label={"Model"}>
              <Input onChange={handleChange} name="model" value={values.model} />
              <Error>{errors.model}</Error>
            </FormField>

            <FormField label={common("description")}>
              <Textarea name="description" onChange={handleChange} value={values.description} />
              <Error>{errors.description}</Error>
            </FormField>

            <footer className="mt-5 flex justify-end">
              <div className="flex items-center">
                <Button
                  type="reset"
                  onClick={() => closeModal(ModalIds.ManageTowCall)}
                  variant="cancel"
                >
                  {common("cancel")}
                </Button>
                <Button
                  className="flex items-center"
                  disabled={!isValid || state === "loading"}
                  type="submit"
                >
                  {state === "loading" ? <Loader className="mr-2" /> : null}
                  {common("create")}
                </Button>
              </div>
            </footer>
          </form>
        )}
      </Formik>
    </Modal>
  );
};